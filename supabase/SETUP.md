# NEXORA + Supabase setup

Supabase project: `narymvkaddrgqjhxmwni`
URL: `https://narymvkaddrgqjhxmwni.supabase.co`

## 1. Create the tables

1. Open https://supabase.com/dashboard/project/narymvkaddrgqjhxmwni
2. **SQL Editor -> New query**
3. Paste the whole contents of `supabase/schema.sql` and click **Run**.
4. Re-run anytime — the script is idempotent.

## 2. Auth settings

- **Authentication -> Providers -> Email** is already enabled.
- **Authentication -> URL Configuration**: set **Site URL** to `https://myzora.netlify.app`.
- Add `https://myzora.netlify.app/**` to **Redirect URLs**.

## 3. Verify from the live site

Open the site, then in the browser console run:

```js
await window.NEXORA_SUPABASE.check()
```

Expected: `{ ok: true, schemaReady: true, message: "Connected" }`.

Quick data test:

```js
await window.NEXORA_SUPABASE.select('profiles', { select: 'id', limit: 5 })
```

## 4. Using it in app code

```js
import { supabaseSelect, supabaseInsert, setSupabaseToken } from './js/supabase.js';

// Feed
const posts = await supabaseSelect('posts', { order: 'created_at.desc', limit: 20 });
await supabaseInsert('posts', { author_id: userId, content: 'Hello NEXORA' });

// When the user signs in, pass their Supabase JWT so RLS allows writes.
setSupabaseToken(userJwt);
```

Available helpers: `supabaseSelect`, `supabaseInsert`, `supabaseUpdate`, `supabaseDelete`,
`setSupabaseToken`, `checkSupabaseConnection`.

## Security notes

- The key in `js/supabase.js` is a **publishable** key — it is safe in browsers by design.
- **Never** put the service role key or the database password in the repo or the site.
- Row Level Security is enabled on every table; writes require a valid user JWT.
- Firebase remains the active auth/data layer. Supabase is additive, so existing
  login, feed, chat, reels, calls and communities keep working unchanged.
