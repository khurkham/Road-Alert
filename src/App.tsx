import { useCallback, useEffect, useRef, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { AlertTriangle, LocateFixed, MapPin, Radio, ShieldCheck, Square } from "lucide-react";

type Position = { lat: number; lng: number; accuracy: number; speed: number | null; heading: number | null; updatedAt: number };
type Vehicle = { id: string; lat: number; lng: number; accuracy: number; speed: number | null; heading: number | null; updatedAt: number };

const carIcon = L.divIcon({ className: "car-marker", html: "🚘", iconSize: [34, 34], iconAnchor: [17, 17] });
const meIcon = L.divIcon({ className: "me-marker", html: '<span class="me-dot"></span>', iconSize: [22, 22], iconAnchor: [11, 11] });

function Recenter({ position }: { position: Position | null }) {
  const map = useMap();
  useEffect(() => { if (position) map.setView([position.lat, position.lng], Math.max(map.getZoom(), 15)); }, [position, map]);
  return null;
}

function distanceMeters(a: Position, b: Vehicle) {
  const rad = (n: number) => n * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(h));
}

export default function App() {
  const [position, setPosition] = useState<Position | null>(null);
  const [gpsMessage, setGpsMessage] = useState("กดปุ่มตำแหน่งเพื่อเริ่มใช้ GPS");
  const [sharing, setSharing] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const watchId = useRef<number | null>(null);
  const sessionId = useRef<string>(crypto.randomUUID());

  const stopSharing = useCallback(async () => {
    setSharing(false);
    if (watchId.current !== null) { navigator.geolocation.clearWatch(watchId.current); watchId.current = null; }
    try { await fetch("/api/vehicles/" + encodeURIComponent(sessionId.current), { method: "DELETE" }); } catch { /* best-effort cleanup; server TTL is the fallback */ }
    setNotice("หยุดแชร์ตำแหน่งแล้ว");
  }, []);

  useEffect(() => () => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    // Do not rely on unload cleanup; server expires location records automatically.
  }, []);

  const locate = () => {
    if (!("geolocation" in navigator)) { setGpsMessage("เบราว์เซอร์นี้ไม่รองรับ GPS"); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      p => {
        setPosition({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, speed: p.coords.speed, heading: p.coords.heading, updatedAt: Date.now() });
        setGpsMessage("รับตำแหน่ง GPS แล้ว · คลาดเคลื่อนประมาณ " + Math.round(p.coords.accuracy) + " เมตร");
        setBusy(false);
      },
      e => { setGpsMessage(e.code === 1 ? "กรุณาอนุญาตให้เว็บไซต์เข้าถึงตำแหน่ง" : "รับตำแหน่งไม่สำเร็จ ลองอีกครั้งเมื่อมีสัญญาณ GPS"); setBusy(false); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
  };

  const startSharing = () => {
    if (!("geolocation" in navigator)) { setNotice("อุปกรณ์นี้ไม่รองรับ GPS"); return; }
    if (!window.isSecureContext) { setNotice("การแชร์ GPS ต้องเปิดผ่าน HTTPS"); return; }
    setNotice("");
    setSharing(true);
    watchId.current = navigator.geolocation.watchPosition(async p => {
      const next: Position = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, speed: p.coords.speed, heading: p.coords.heading, updatedAt: Date.now() };
      setPosition(next);
      setGpsMessage("กำลังแชร์ตำแหน่งที่คุณยินยอม");
      try {
        const res = await fetch("/api/vehicles/" + encodeURIComponent(sessionId.current), {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next)
        });
        if (!res.ok) setNotice("ส่งตำแหน่งไม่สำเร็จ โปรดตรวจสอบว่า Worker ได้ Deploy แล้ว");
      } catch { setNotice("เชื่อมต่อระบบแชร์ตำแหน่งไม่ได้"); }
    }, e => { setGpsMessage("GPS ขัดข้อง: " + e.message); }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 });
  };

  useEffect(() => {
    if (!sharing) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const r = await fetch("/api/vehicles");
        if (r.ok) { const data = await r.json() as { vehicles: Vehicle[] }; if (!cancelled) setVehicles(data.vehicles.filter(v => v.id !== sessionId.current)); }
      } catch { /* show no stale data if API is unreachable */ if (!cancelled) setVehicles([]); }
    };
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [sharing]);

  const nearby = position ? vehicles.map(v => ({ ...v, distance: distanceMeters(position, v) })).filter(v => Date.now() - v.updatedAt < 120000).sort((a,b) => a.distance - b.distance) : [];

  return <main className="app-shell">
    <header className="topbar"><div className="brand-mark"><Radio size={21} /></div><div><h1>Road Alert</h1><p>ระบบนำทางและแจ้งเตือนรถ · รุ่นทดลอง</p></div><span className="trial-badge">ทดลองใช้</span></header>
    <section className="map-wrap">
      <MapContainer center={[19.3, 97.97]} zoom={9} zoomControl={false} className="map">
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Recenter position={position} />
        {position && <Marker position={[position.lat, position.lng]} icon={meIcon} />}
        {sharing && nearby.map(v => <Marker key={v.id} position={[v.lat, v.lng]} icon={carIcon} />)}
      </MapContainer>
      <button className="locate-btn" onClick={locate} disabled={busy}><LocateFixed size={18}/>{busy ? "กำลังค้นหา..." : "ตำแหน่งของฉัน"}</button>
      <div className="map-caption"><MapPin size={15}/>{gpsMessage}</div>
    </section>
    <section className="content">
      <div className="panel">
        <div className="panel-title"><div><h2>แชร์ตำแหน่งรถ</h2><p>ไม่มีบัญชีผู้ใช้ · เปิดแชร์เมื่อคุณยินยอมเท่านั้น</p></div><ShieldCheck size={24}/></div>
        {!sharing ? <button className="primary-btn" onClick={startSharing}><Radio size={18}/>ยินยอมและเริ่มแชร์ตำแหน่ง</button> : <button className="stop-btn" onClick={stopSharing}><Square size={16} fill="currentColor"/>หยุดแชร์ตำแหน่งทันที</button>}
        <p className="privacy-note">เมื่อเปิดแชร์ ระบบจะส่งตำแหน่ง GPS และความเร็ว (ถ้าอุปกรณ์ให้ข้อมูล) ไปยัง Cloudflare เพื่อแสดงรถที่เข้าร่วม ข้อมูลจะหมดอายุอัตโนมัติภายใน 2 นาทีหลังไม่มีการอัปเดต การกดหยุดแชร์จะพยายามลบข้อมูลทันที</p>
        {notice && <div className="notice"><AlertTriangle size={16}/>{notice}</div>}
      </div>
      <div className="panel status-panel"><div className="panel-title"><div><h2>รถที่รายงานตำแหน่ง</h2><p>แสดงเฉพาะรถที่แชร์ตำแหน่งสดและข้อมูลยังไม่หมดอายุ</p></div><span className="count">{sharing ? nearby.length : "—"}</span></div>
        {!sharing ? <p className="empty">เปิดโหมดแชร์ตำแหน่งเพื่อทดลองดูรถที่เข้าร่วมระบบ</p> : nearby.length ? nearby.slice(0,5).map(v => <div className="vehicle-row" key={v.id}><span className="vehicle-icon">🚘</span><div className="vehicle-info"><strong>รถที่เข้าร่วม</strong><small>อัปเดต {Math.max(0,Math.round((Date.now()-v.updatedAt)/1000))} วินาทีที่แล้ว</small></div><strong>{v.distance < 1000 ? Math.round(v.distance)+" ม." : (v.distance/1000).toFixed(1)+" กม."}</strong></div>) : <p className="empty">ยังไม่มีรถคันอื่นรายงานตำแหน่งในขณะนี้</p>}
      </div>
      <div className="safety"><AlertTriangle size={19}/><p><strong>ข้อควรทราบ:</strong> นี่คือรุ่นทดลอง ไม่ใช่ระบบความปลอดภัยที่รับประกันการตรวจจับรถทุกคัน รถที่ไม่แชร์ตำแหน่งจะไม่ปรากฏ และยังไม่มีระบบคำนวณเส้นทางนำทางแบบเลี้ยวต่อเลี้ยว</p></div>
    </section>
    <footer>Road Alert · รุ่นทดลอง · ตำแหน่งของคุณจะถูกส่งเมื่อคุณเปิดแชร์เท่านั้น</footer>
  </main>;
}
