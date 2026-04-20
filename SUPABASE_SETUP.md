# Supabase 接入步骤

## 1. 创建表和权限

打开 Supabase Dashboard 的 `SQL Editor`，把 [supabase/schema.sql](supabase/schema.sql) 里的内容整段执行一次。

这一步会创建：

- `mini_notion_notes`
- `secret_diary_entries`
- 只允许登录用户读写自己数据的 `RLS` 策略

## 2. 创建你自己的登录账号

更稳妥的方式是：

1. 打开 `Authentication > Users`
2. 手动创建一个只有你自己知道邮箱和密码的账号

如果你不想开放任何公开注册，就不要做前台注册页，直接用现在仓库里的 [login.html](login.html) 登录即可。

## 3. 在 Vercel 里配置环境变量

到 Vercel 项目的环境变量里新增：

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

这两个值都在 Supabase Dashboard 的 `Project Settings > API` 里能找到。

注意：

- 这里要用的是 `anon` / `publishable` key
- 不要把 `service_role` key 放到前端或公开环境里

## 4. 重新部署

填完环境变量以后，让 Vercel 重新部署一次。

部署成功后：

- [login.html](login.html) 可以登录
- [notion.html](notion.html) 会自动读写 Supabase
- [secret-diary.html](secret-diary.html) 会自动读写 Supabase

## 5. 如果你以前已经写过本地内容

登录后打开对应页面：

- Mini Notion：点 `导入本地旧数据`
- 秘密日记：点 `导入本地旧日记`

这样可以把当前浏览器旧版 `localStorage` 里的内容迁到 Supabase。
