# Road Alert

ระบบทดลองแผนที่และแชร์ตำแหน่งรถโดยไม่ต้องสมัครสมาชิก

## สถานะรุ่นทดลอง
- Frontend: React + TypeScript + Vite, แผนที่ Leaflet/OpenStreetMap
- อ่าน GPS เมื่อผู้ใช้อนุญาต และเริ่มแชร์เฉพาะเมื่อกดยินยอม
- ปุ่มหยุดแชร์พยายามลบตำแหน่งทันที
- Worker API ใช้ Durable Object VehicleRegistry เก็บตำแหน่งชั่วคราวและลบข้อมูลที่เก่ากว่า 120 วินาที
- API routes: GET /api/health, GET /api/vehicles, PUT /api/vehicles/:id, DELETE /api/vehicles/:id

## Deploy อัตโนมัติด้วย GitHub Actions
Workflow `.github/workflows/deploy-cloudflare.yml` จะทำงานเมื่อมีการ push ไปที่ `setup/road-alert-trial` และสามารถสั่งด้วยมือจาก GitHub Actions ได้ โดยจะ build frontend, ตรวจ config, deploy Worker API และ deploy Cloudflare Pages ตามลำดับ

### Secrets ที่จำเป็น
ใน GitHub repository Environment ชื่อ `Cloudflare` ต้องมี:
- `CLOUDFLARE_API_TOKEN`: Token ที่มีสิทธิ์ Workers Scripts Edit, Cloudflare Pages Edit และ Account Settings Read สำหรับบัญชีที่ใช้งาน
- `CLOUDFLARE_ACCOUNT_ID`: Account ID ของบัญชี Cloudflare

Token ควรจำกัดสิทธิ์ไว้เฉพาะบัญชีที่จำเป็น และห้ามใส่ค่า Token ในไฟล์โค้ดหรือ log

### Cloudflare resources
- Worker name: `road-alert-api` (ตั้งค่าจาก `wrangler.toml`)
- Pages project: `road-alert`
- Deploy branch: `setup/road-alert-trial` (อย่าใช้ `main` ในขณะนี้ เพราะ branch `main` ยังไม่มีแอป)

Wrangler อ่าน `wrangler.toml` เพื่อ deploy `worker/index.ts`, ตั้งค่า binding `VEHICLES` และดำเนิน migration ของ Durable Object `VehicleRegistry` ตาม config. ไม่ต้องสร้าง binding ด้วยมือหาก deploy ผ่าน Wrangler

ใช้ GitHub Actions เป็นช่องทาง deploy หลักเพียงช่องทางเดียว เพื่อหลีกเลี่ยงการ deploy ซ้ำจาก Cloudflare Workers Builds หรือระบบเชื่อม Git อื่นที่ตั้งค่าไว้ให้ deploy Worker เดียวกัน

## Deploy frontend
Cloudflare Pages project `road-alert`:
- Production branch ควรตั้งเป็น `setup/road-alert-trial` หากต้องการให้ branch นี้เป็น production deployment
- Build command (สำหรับการตั้งค่า build ผ่าน Dashboard แทน Actions): `npm run build`
- Build output directory: `dist`
- Root directory: `/`

Pages Function `functions/api/[[path]].ts` forwards `/api/*` requests to `https://road-alert-api.bejaitai.workers.dev`.

## Local development
Requires Node.js 20+:
```bash
npm install
npm run dev
```
In another terminal:
```bash
npm run worker:dev
```

## Smoke tests after deployment
- Open https://road-alert-api.bejaitai.workers.dev/api/health; expected JSON with ok: true.
- Open https://road-alert-dg4.pages.dev/api/health; expected the same health JSON via Pages proxy.
- Open https://road-alert-dg4.pages.dev/api/vehicles; expected `{"vehicles":[]}` when no one is sharing.
- Test sharing with two devices, then stop sharing and confirm the marker disappears; stale records expire within about two minutes.
- Check the GitHub Actions run before assuming a deployment succeeded.

## Privacy and safety
This is a trial, not a collision avoidance or safety-certified navigation system. Only participating devices that consent to share can appear; GPS does not detect cars that are not sharing, vehicles hidden around bends, or vehicles behind obstacles. Mobile browsers may suspend GPS in background tabs. Do not rely on this prototype as a substitute for safe driving.

Before public use, add stronger abuse protection/rate limiting and privacy review. Standard OpenStreetMap tile service has usage policies and capacity limits; choose a suitable tile provider before scaling.
