import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('catalogue migration runs on PostgreSQL and preserves ownership, snapshots and retries', async (t) => {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth,storage to authenticated,anon;
    alter default privileges in schema public grant all on tables to authenticated;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner_id text);
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;
  `)
  const migrations = new URL('../../supabase/migrations/', import.meta.url)
  for (const file of (await readdir(migrations)).sort()) {
    try {
      await db.exec(await readFile(new URL(file, migrations), 'utf8'))
    } catch (error) {
      throw new Error(`Migration ${file}: ${error.message}`)
    }
  }
  const a = randomUUID(),
    b = randomUUID(),
    cat = randomUUID(),
    floral = randomUUID()
  await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)', [
    a,
    'a@example.test',
    b,
    'b@example.test',
  ])
  await db.query(
    'insert into categories(id,user_id,name,manual_only) values($1,$2,$3,false),($4,$2,$5,true)',
    [cat, a, 'Visa americana', floral, 'Diseños de flores'],
  )
  async function as(user, fn) {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user,
    ])
    await db.exec('set role authenticated')
    try {
      return await fn()
    } finally {
      await db.exec('reset role')
    }
  }
  const asset = randomUUID()
  await db.query(
    'insert into media_assets(id,user_id,storage_path,file_name,mime_type,byte_size) values($1,$2,$3,$4,$5,50)',
    [asset, a, `${a}/foto.jpg`, 'foto.jpg', 'image/jpeg'],
  )
  const content = {
    titulo: 'Copy aprobado',
    texto: 'Texto original',
    categoria: cat,
    imagenes: [asset],
    automatica: true,
    pagina: 'tocoa',
    vence: null,
  }
  const request = randomUUID()
  let pub
  await t.test(
    'saving from ChatGPT is idempotent and uses the existing library',
    async () => {
      pub = await as(
        a,
        async () =>
          (
            await db.query(
              'select save_my_mcp_publication($1,$2::jsonb) as id',
              [request, JSON.stringify(content)],
            )
          ).rows[0].id,
      )
      const retry = await as(
        a,
        async () =>
          (
            await db.query(
              'select save_my_mcp_publication($1,$2::jsonb) as id',
              [request, JSON.stringify(content)],
            )
          ).rows[0].id,
      )
      assert.equal(retry, pub)
      assert.equal(
        (await db.query('select count(*)::int as n from publications')).rows[0]
          .n,
        1,
      )
      await assert.rejects(
        () =>
          as(a, () =>
            db.query('select save_my_mcp_publication($1,$2::jsonb)', [
              request,
              JSON.stringify({ ...content, texto: 'otro' }),
            ]),
          ),
        /reused/,
      )
      await assert.rejects(() =>
        as(b, () =>
          db.query('select save_my_mcp_publication($1,$2::jsonb)', [
            randomUUID(),
            JSON.stringify(content),
          ]),
        ),
      )
    },
  )
  await t.test('flower approval is forced off', async () => {
    const result = await as(a, () =>
      db.query('select save_my_mcp_publication($1,$2::jsonb) as id', [
        randomUUID(),
        JSON.stringify({ ...content, categoria: floral }),
      ]),
    )
    assert.equal(
      (
        await db.query(
          'select approved_for_batch from publications where id=$1',
          [result.rows[0].id],
        )
      ).rows[0].approved_for_batch,
      false,
    )
  })
  const plan = randomUUID(),
    job = randomUUID()
  const tomorrow = new Date(Date.now() + 86400000).toISOString()
  const snapshot = {
    titulo: 'Copy aprobado',
    texto: 'Texto original',
    imagenes: [asset + '.jpg'],
  }
  const jobs = [
    {
      id: job,
      publication_id: pub,
      planned_for: tomorrow,
      page: 'tocoa',
      snapshot,
    },
  ]
  await t.test(
    'confirming a plan registers all calendar slots, or rolls back all of them',
    async () => {
      const invalid = [
        ...jobs,
        { ...jobs[0], id: randomUUID(), publication_id: randomUUID() },
      ]
      await assert.rejects(() =>
        as(a, () =>
          db.query('select register_my_mcp_plan($1,$2::jsonb)', [
            plan,
            JSON.stringify(invalid),
          ]),
        ),
      )
      assert.equal(
        (await db.query('select count(*)::int as n from scheduled_posts'))
          .rows[0].n,
        0,
      )
      await as(a, () =>
        db.query('select register_my_mcp_plan($1,$2::jsonb)', [
          plan,
          JSON.stringify(jobs),
        ]),
      )
      await as(a, () =>
        db.query('select register_my_mcp_plan($1,$2::jsonb)', [
          plan,
          JSON.stringify(jobs),
        ]),
      )
      assert.equal(
        (await db.query('select count(*)::int as n from scheduled_posts'))
          .rows[0].n,
        1,
      )
      const other = await as(b, () => db.query('select * from scheduled_posts'))
      assert.equal(other.rows.length, 0)
      await assert.rejects(() =>
        as(b, () =>
          db.query('select register_my_mcp_plan($1,$2::jsonb)', [
            randomUUID(),
            JSON.stringify(jobs),
          ]),
        ),
      )
    },
  )
  await t.test(
    'delivery is not history; real confirmation records the approved snapshot',
    async () => {
      await as(a, () =>
        db.query('select update_my_mcp_delivery($1,$2,$3)', [
          job,
          'En Meta',
          '123_456',
        ]),
      )
      assert.equal(
        (await db.query('select count(*)::int as n from publication_history'))
          .rows[0].n,
        0,
      )
      await db.query('update publications set title=$1,body=$2 where id=$3', [
        'Título cambiado',
        'Copy cambiado',
        pub,
      ])
      await db.query('delete from publication_media where publication_id=$1', [
        pub,
      ])
      const published = new Date().toISOString()
      await as(a, () =>
        db.query('select record_my_mcp_use($1,$2,$3)', [
          job,
          published,
          '123_456',
        ]),
      )
      await as(a, () =>
        db.query('select record_my_mcp_use($1,$2,$3)', [
          job,
          published,
          '123_456',
        ]),
      )
      const history = (await db.query('select * from publication_history')).rows
      assert.equal(history.length, 1)
      assert.equal(history[0].title_snapshot, 'Copy aprobado')
      assert.equal(history[0].copy_snapshot, 'Texto original')
      assert.equal(history[0].media_snapshot[0].id, asset)
      assert.equal(
        (
          await db.query('select status from scheduled_posts where id=$1', [
            job,
          ])
        ).rows[0].status,
        'fulfilled',
      )
    },
  )
  await t.test('anonymous callers cannot invoke bridge RPCs', async () => {
    await db.exec('set role anon')
    try {
      await assert.rejects(
        () =>
          db.query('select update_my_mcp_delivery($1,$2,$3)', [
            job,
            'En Meta',
            'x',
          ]),
        /permission denied/,
      )
    } finally {
      await db.exec('reset role')
    }
  })
})
