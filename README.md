# Road Alert

ระบบทดลองนำทางและแจ้งเตือนรถ เปิดให้ใช้งานโดยไม่ต้องสมัครสมาชิก

## รุ่นทดลองใน branch นี้
- เว็บ React + TypeScript + Vite
- แผนที่ Leaflet / OpenStreetMap
- อ่านตำแหน่งจาก GPS ของอุปกรณ์เมื่อผู้ใช้อนุญาต
- แชร์ตำแหน่งรถเฉพาะเมื่อกดเริ่มแชร์ และมีปุ่มหยุดแชร์
- Worker API + Durable Objects เก็บตำแหน่งรถชั่วคราว หมดอายุหลัง 120 วินาที
- ไม่มีบัญชีสมาชิกและไม่มี D1 ในรุ่นแรก

## พัฒนาในเครื่อง
ต้องใช้ Node.js 20 ขึ้นไป

```bash
npm install
npm run dev
```

Worker ในอีก terminal:

```bash
npm run worker:dev
```

## การ Deploy
1. สร้าง Cloudflare Worker ตาม `wrangler.toml` และ deploy API
2. Deploy frontend ไป Cloudflare Pages โดยตั้ง build command `npm run build` และ output directory `dist`
3. ตั้งค่า Pages Functions หรือ reverse proxy ให้ `/api/*` ส่งไปยัง Worker API
4. ทดสอบ `/api/health`, การแชร์ตำแหน่ง, การหยุดแชร์ และการหมดอายุข้อมูลก่อนเปิดให้สาธารณะ

## ข้อจำกัดที่ทราบ
- ยังไม่มี routing engine / turn-by-turn directions, voice navigation หรือ collision prediction
- รถจะปรากฏได้เมื่ออุปกรณ์นั้นเข้าร่วมและแชร์ตำแหน่งเท่านั้น
- เว็บไซต์ต้องทำงานผ่าน HTTPS เพื่อใช้ GPS
- Browser บนมือถืออาจจำกัดการติดตามตำแหน่งเมื่อหน้าจอดับหรือแท็บอยู่เบื้องหลัง
- OpenStreetMap standard tile server มีนโยบายการใช้งานและข้อจำกัด ควรเลือกผู้ให้บริการไทล์ที่เหมาะสมก่อนเปิดให้ผู้ใช้จำนวนมาก
- รุ่นนี้เป็นต้นแบบทดสอบ ไม่ใช่อุปกรณ์ความปลอดภัยและไม่รับประกันการตรวจจับรถทุกคัน
