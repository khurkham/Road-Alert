# Road Alert

ระบบทดลองแผนที่และแชร์ตำแหน่งรถโดยไม่ต้องสมัครสมาชิก

## สถานะรุ่นทดลอง
- Frontend: React + TypeScript + Vite, แผนที่ Leaflet/OpenStreetMap
- อ่าน GPS เมื่อผู้ใช้อนุญาต และเริ่มแชร์เฉพาะเมื่อกดยินยอม
- ปุ่มหยุดแชร์พยายามลบตำแหน่งทันที
- Worker API ใช้ Durable Object VehicleRegistry เก็บตำแหน่งชั่วคราวและลบข้อมูลที่เก่ากว่า 120 วินาที
- API routes: GET /api/health, GET /api/vehicles, PUT /api/vehicles/:id, DELETE /api/vehicles/:id

## Deploy API Worker ด้วย Cloudflare Workers Builds
Worker ที่สร้างด้วยหน้า Hello World ใน Dashboard จะยังเป็น Hello World จนกว่าจะ deploy โค้ดใน repo นี้

1. เปิด Worker road-alert-api ใน Cloudflare Dashboard แล้วไปที่ Settings > Builds (ชื่อเมนูอาจต่างกันเล็กน้อย)
2. เชื่อม GitHub repository khurkham/Road-Alert
3. ตั้ง production branch เป็น setup/road-alert-trial (อย่าใช้ main ในขณะนี้ เพราะ branch main ยังไม่มีแอป)
4. ตั้ง Build command เป็น npm run worker:check และ Deploy command เป็น npm run worker:deploy. ถ้าหน้าตั้งค่าต้องการคำสั่งติดตั้งแยก ให้ใช้ npm install.
5. บันทึกและสั่ง deploy จาก branch ดังกล่าว รอให้ build/deploy สำเร็จ

Wrangler จะอ่าน wrangler.toml, deploy worker/index.ts, สร้าง binding VEHICLES และ migrate class VehicleRegistry ตาม config. ไม่ต้องสร้าง Durable Object binding ด้วยมือใน Dashboard สำหรับวิธีนี้

## Deploy frontend
Cloudflare Pages project road-alert:
- Production branch: setup/road-alert-trial
- Framework preset: React (Vite)
- Build command: npm run build
- Build output directory: dist
- Root directory: /

Pages Function functions/api/[[path]].ts forwards /api/* requests to https://road-alert-api.bejaitai.workers.dev.

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
- Open https://road-alert-dg4.pages.dev/api/vehicles; expected {"vehicles":[]} when no one is sharing.
- Test sharing with two devices, then stop sharing and confirm the marker disappears; stale records expire within about two minutes.

## Privacy and safety
This is a trial, not a collision avoidance or safety-certified navigation system. Only participating devices that consent to share can appear; GPS does not detect cars that are not sharing, vehicles hidden around bends, or vehicles behind obstacles. Mobile browsers may suspend GPS in background tabs. Do not rely on this prototype as a substitute for safe driving.

Before public use, add stronger abuse protection/rate limiting and privacy review. Standard OpenStreetMap tile service has usage policies and capacity limits; choose a suitable tile provider before scaling.
