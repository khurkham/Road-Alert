import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import maplibregl, { type Map as MapLibreMap, type GeoJSONSource } from "maplibre-gl";
import { AlertTriangle, LocateFixed, MapPin, Navigation, Radio, Route as RouteIcon, ShieldCheck, Square, Volume2, Siren, Menu, X, Layers, Satellite, Box } from "lucide-react";

type Position = { lat: number; lng: number; accuracy: number; speed: number | null; heading: number | null; updatedAt: number };
type Vehicle = { id: string; lat: number; lng: number; accuracy: number; speed: number | null; heading: number | null; updatedAt: number };
type RoutePoint = { lat: number; lng: number };
type HazardType = "accident" | "broken_vehicle" | "obstacle" | "road_hazard";
type Hazard = { id: string; lat: number; lng: number; type: HazardType; note: string; createdAt: number };
type RouteStep = { distance: number; duration: number; name: string; maneuver: { type: string; modifier?: string; location: [number, number] } };
type RouteResult = { distance: number; duration: number; geometry: { coordinates: [number, number][] }; legs?: Array<{ steps: RouteStep[] }> };

const STREET_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const SATELLITE_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
type RoadMapProps = {
  mapLayer: "standard" | "satellite"; position: Position | null; originPoint: RoutePoint | null; destinationPoint: RoutePoint | null;
  routePoints: RoutePoint[]; sharing: boolean; vehicles: Vehicle[]; hazards: Hazard[]; pickTarget: "origin" | "destination" | null;
  onPick: (point: RoutePoint, target: "origin" | "destination") => void;
  onMovePin: (point: RoutePoint, target: "origin" | "destination") => void;
};
function RoadMap({mapLayer,position,originPoint,destinationPoint,routePoints,sharing,vehicles,hazards,pickTarget,onPick,onMovePin}:RoadMapProps) {
  const host=useRef<HTMLDivElement|null>(null), mapRef=useRef<MapLibreMap|null>(null), markersRef=useRef<maplibregl.Marker[]>([]);\n  const [styleReady,setStyleReady]=useState(false);
  const propsRef=useRef({position,originPoint,destinationPoint,routePoints,sharing,vehicles,hazards,pickTarget,onPick,onMovePin,mapLayer});
  propsRef.current={position,originPoint,destinationPoint,routePoints,sharing,vehicles,hazards,pickTarget,onPick,onMovePin,mapLayer};
  const setupStyle=useCallback((map:MapLibreMap, layer:"standard"|"satellite")=>{
    if(!map.isStyleLoaded())return;
    if(layer==="satellite"){
      if(!map.getSource("road-alert-satellite")){
        map.addSource("road-alert-satellite",{type:"raster",tiles:[SATELLITE_TILES],tileSize:256,attribution:"Imagery © Esri"});
        const layers=map.getStyle().layers||[];
        const firstSymbol=layers.find(l=>l.type==="symbol")?.id;
        map.addLayer({id:"road-alert-satellite-layer",type:"raster",source:"road-alert-satellite",paint:{"raster-opacity":1}},firstSymbol);
      }
      map.getStyle().layers?.forEach(l=>{if(l.type==="fill"&&!l.id.includes("building")){try{map.setPaintProperty(l.id,"fill-opacity",0.12)}catch{}}});
    }else{
      if(map.getLayer("road-alert-satellite-layer"))map.removeLayer("road-alert-satellite-layer");
      if(map.getSource("road-alert-satellite"))map.removeSource("road-alert-satellite");
      map.getStyle().layers?.forEach(l=>{if(l.type==="fill"&&!l.id.includes("building")){try{map.setPaintProperty(l.id,"fill-opacity",1)}catch{}}});
    }
    if(!map.getSource("road-alert-route")){
      map.addSource("road-alert-route",{type:"geojson",data:{type:"Feature",properties:{},geometry:{type:"LineString",coordinates:[]} }});
      map.addLayer({id:"road-alert-route-line",type:"line",source:"road-alert-route",layout:{"line-join":"round","line-cap":"round"},paint:{"line-color":"#20d889","line-width":6,"line-opacity":0.95}});
    }
    if(!map.getLayer("road-alert-3d-buildings")&&map.getSource("openmaptiles")){
      try{map.addLayer({id:"road-alert-3d-buildings",source:"openmaptiles","source-layer":"building",type:"fill-extrusion",minzoom:13,filter:["all",["!=",["get","hide_3d"],true]],paint:{"fill-extrusion-color":["coalesce",["get","render_colour"],["get","colour"],"#aeb8c1"],"fill-extrusion-height":["interpolate",["linear"],["zoom"],13,0,15,["coalesce",["get","render_height"],["get","height"],8]],"fill-extrusion-base":["coalesce",["get","render_min_height"],["get","min_height"],0],"fill-extrusion-opacity":0.82}})}catch{/* style may not expose building source */}}
  },[]);
  useEffect(()=>{
    if(!host.current||mapRef.current)return;
    const map=new maplibregl.Map({container:host.current,style:STREET_STYLE,center:[97.97,19.3],zoom:9,pitch:55,bearing:0,antialias:true, maxPitch:70});
    mapRef.current=map;
    map.addControl(new maplibregl.NavigationControl({visualizePitch:true}),"bottom-right");
    map.on("style.load",()=>{setupStyle(map,propsRef.current.mapLayer);});
    map.on("click",e=>{const p=propsRef.current;if(p.pickTarget)p.onPick({lat:e.lngLat.lat,lng:e.lngLat.lng},p.pickTarget);});
    return()=>{markersRef.current.forEach(m=>m.remove());markersRef.current=[];map.remove();mapRef.current=null;};
  },[setupStyle]);
  useEffect(()=>{const map=mapRef.current;if(!map)return;const apply=()=>setupStyle(map,mapLayer);if(map.isStyleLoaded())apply();else map.once("style.load",apply);},[mapLayer,setupStyle]);
  useEffect(()=>{const map=mapRef.current;if(!map)return;const source=map.getSource("road-alert-route") as GeoJSONSource|undefined;if(source)source.setData({type:"Feature",properties:{},geometry:{type:"LineString",coordinates:routePoints.map(p=>[p.lng,p.lat])}});if(routePoints.length>1)map.fitBounds(new maplibregl.LngLatBounds([routePoints[0].lng,routePoints[0].lat],[routePoints[routePoints.length-1].lng,routePoints[routePoints.length-1].lat]),{padding:55,maxZoom:16});},[routePoints]);
  useEffect(()=>{const map=mapRef.current;if(!map||!position)return;map.easeTo({center:[position.lng,position.lat],zoom:Math.max(map.getZoom(),15),duration:500});},[position?.lat,position?.lng]);
  useEffect(()=>{
    const map=mapRef.current;if(!map||!map.isStyleLoaded())return;
    markersRef.current.forEach(m=>m.remove());markersRef.current=[];
    const add=(point:RoutePoint,html:string,cls:string,draggable=false,target?:"origin"|"destination")=>{
      const el=document.createElement("div");el.className=cls;el.innerHTML=html;
      const marker=new maplibregl.Marker({element:el,anchor:"bottom",draggable}).setLngLat([point.lng,point.lat]).addTo(map);
      if(draggable&&target)marker.on("dragend",()=>{const p=marker.getLngLat();propsRef.current.onMovePin({lat:p.lat,lng:p.lng},target);});
      markersRef.current.push(marker);
    };
    if(position)add(position,'<span class="me-dot"></span>',"map-marker-me");
    if(originPoint)add(originPoint,"📍","map-marker-pin",true,"origin");
    if(destinationPoint)add(destinationPoint,"📍","map-marker-pin",true,"destination");
    if(sharing)vehicles.filter(v=>Date.now()-v.updatedAt<120000).forEach(v=>add(v,"🚘","map-marker-car"));
    hazards.filter(h=>Date.now()-h.createdAt<1800000).forEach(h=>add(h,h.type==="accident"?"🚨":h.type==="broken_vehicle"?"🚗":h.type==="obstacle"?"🪨":"⚠️","map-marker-hazard"));
  },[position,originPoint,destinationPoint,sharing,vehicles,hazards,mapLayer,styleReady]);
  return <div ref={host} className="map maplibre-map" aria-label="แผนที่นำทาง 3D"/>;
}

const hazardLabels: Record<HazardType, string> = { accident: "อุบัติเหตุ", broken_vehicle: "รถเสีย", obstacle: "สิ่งกีดขวาง", road_hazard: "อันตรายบนถนน" };
function stepText(step: RouteStep) { const m=step.maneuver, mod=m.modifier||""; let action="ขับต่อไป"; if(m.type==="depart") action="เริ่มเดินทาง"; else if(m.type==="arrive") action="ถึงจุดหมายแล้ว"; else if(m.type==="turn"||m.type==="end of road") action=mod.includes("left")?"เลี้ยวซ้าย":mod.includes("right")?"เลี้ยวขวา":mod.includes("uturn")?"กลับรถ":"ขับตรงไป"; else if(m.type.includes("roundabout")) action="เข้าวงเวียน"; else if(m.type==="merge") action="รวมเข้าช่องทาง"; return action+(step.name?" เข้าสู่ "+step.name:""); }
function speakThai(text: string) { if (!("speechSynthesis" in window)) return; window.speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(text); u.lang="th-TH"; u.rate=0.92; const v=window.speechSynthesis.getVoices().find(v=>v.lang.toLowerCase().startsWith("th")); if(v)u.voice=v; window.speechSynthesis.speak(u); }

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (n: number) => n * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(h));
}
async function geocode(query: string): Promise<RoutePoint> {
  // Explicit user-submitted searches only; no autocomplete.
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  const response = await fetch(url);
  if (!response.ok) throw new Error("ค้นหาสถานที่ไม่สำเร็จ");
  const data = await response.json() as Array<{ lat: string; lon: string; display_name: string }>;
  if (!data.length) throw new Error('ไม่พบสถานที่: "' + query + '"');
  return { lat: Number(data[0].lat), lng: Number(data[0].lon) };
}
export default function App() {
  const [position, setPosition] = useState<Position | null>(null);
  const [gpsMessage, setGpsMessage] = useState("กดปุ่มตำแหน่งเพื่อเริ่มใช้ GPS");
  const [sharing, setSharing] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mapLayer, setMapLayer] = useState<"standard" | "satellite">("standard");
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [pickTarget, setPickTarget] = useState<"origin" | "destination" | null>(null);
  const [originPoint, setOriginPoint] = useState<RoutePoint | null>(null);
  const [destinationPoint, setDestinationPoint] = useState<RoutePoint | null>(null);
  const [routePoints, setRoutePoints] = useState<RoutePoint[]>([]);
  const [routeOptions, setRouteOptions] = useState<RouteResult[]>([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [routeSummary, setRouteSummary] = useState("");
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [nearbyAlert, setNearbyAlert] = useState("");
  const [hazards,setHazards]=useState<Hazard[]>([]); const [hazardType,setHazardType]=useState<HazardType>("accident"); const [hazardNote,setHazardNote]=useState(""); const [hazardBusy,setHazardBusy]=useState(false); const [hazardAlert,setHazardAlert]=useState(""); const [voiceOn,setVoiceOn]=useState(true); const [routeSteps,setRouteSteps]=useState<RouteStep[]>([]); const [currentStep,setCurrentStep]=useState(0); const announcedStep=useRef(-1); const announcedHazards=useRef<Set<string>>(new Set());
  const watchId = useRef<number | null>(null);
  const sessionId = useRef<string>(crypto.randomUUID());
  const alertedIds = useRef<Set<string>>(new Set());

  const stopSharing = useCallback(async () => {
    setSharing(false);
    alertedIds.current.clear();
    setNearbyAlert("");
    if (watchId.current !== null) { navigator.geolocation.clearWatch(watchId.current); watchId.current = null; }
    try { await fetch("/api/vehicles/" + encodeURIComponent(sessionId.current), { method: "DELETE" }); } catch { /* server TTL is fallback */ }
    setNotice("หยุดแชร์ตำแหน่งแล้ว");
  }, []);

  useEffect(() => () => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
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
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    setGpsMessage("กำลังขอสิทธิ์และค้นหา GPS...");
    setSharing(true);
    watchId.current = navigator.geolocation.watchPosition(async p => {
      const next: Position = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, speed: p.coords.speed, heading: p.coords.heading, updatedAt: Date.now() };
      setPosition(next);
      setGpsMessage("กำลังแชร์ตำแหน่งที่คุณยินยอม");
      try {
        const res = await fetch("/api/vehicles/" + encodeURIComponent(sessionId.current), {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next)
        });
        if (!res.ok) setNotice("ส่งตำแหน่งไม่สำเร็จ โปรดตรวจสอบว่า Worker ได้ Deploy แล้ว");
      } catch { setNotice("เชื่อมต่อระบบแชร์ตำแหน่งไม่ได้"); }
    }, e => {
      if (e.code === 1) {
        if (watchId.current !== null) { navigator.geolocation.clearWatch(watchId.current); watchId.current = null; }
        setSharing(false);
        setGpsMessage("ไม่ได้รับสิทธิ์ตำแหน่ง กรุณาอนุญาตในการตั้งค่าเว็บไซต์");
        setNotice("สิทธิ์ตำแหน่งถูกปฏิเสธหรือถูกปิดไว้: กดไอคอนตั้งค่าข้างที่อยู่เว็บ > สิทธิ์ > ตำแหน่ง > อนุญาต แล้วโหลดหน้าใหม่");
      } else if (e.code === 2) {
        setGpsMessage("ยังหาตำแหน่ง GPS ไม่พบ ตรวจสอบ Location และสัญญาณ GPS");
        setNotice("เปิด Location ของโทรศัพท์ และลองใกล้หน้าต่างหรือกลางแจ้ง ระบบจะลองรับตำแหน่งต่อเมื่อมีสัญญาณ");
      } else {
        setGpsMessage("GPS ใช้เวลานานกว่าปกติ กำลังรอตำแหน่ง...");
      }
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  };

  useEffect(() => {
    if (!sharing) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const [r,hr]=await Promise.all([fetch("/api/vehicles"),fetch("/api/hazards")]);
        if (r.ok) { const data = await r.json() as { vehicles: Vehicle[] }; if (!cancelled) setVehicles(data.vehicles.filter(v => v.id !== sessionId.current)); }
        if(hr.ok){const data=await hr.json() as {hazards:Hazard[]};if(!cancelled)setHazards(data.hazards);}
      } catch { if (!cancelled) setVehicles([]); }
    };
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [sharing]);

  const nearby = position ? vehicles.map(v => ({ ...v, distance: distanceMeters(position, v) })).filter(v => Date.now() - v.updatedAt < 120000).sort((a,b) => a.distance - b.distance) : [];
  const closeVehicles = sharing ? nearby.filter(v => v.distance <= 500) : [];
  const nearbyHazards=position?hazards.map(h=>({...h,distance:distanceMeters(position,h)})).filter(h=>Date.now()-h.createdAt<1800000).sort((a,b)=>a.distance-b.distance):[]; const closeHazards=nearbyHazards.filter(h=>h.distance<=500);

  useEffect(() => {
    if (!sharing || !position) { setNearbyAlert(""); alertedIds.current.clear(); return; }
    const current = new Set(closeVehicles.map(v => v.id));
    for (const id of alertedIds.current) if (!current.has(id)) alertedIds.current.delete(id);
    const newlyClose = closeVehicles.filter(v => !alertedIds.current.has(v.id));
    if (newlyClose.length) {
      setNearbyAlert("เตือน: มีรถที่แชร์ตำแหน่งอยู่ภายใน 500 เมตร จำนวน " + closeVehicles.length + " คัน");
      newlyClose.forEach(v => alertedIds.current.add(v.id));
      if ("vibrate" in navigator) navigator.vibrate?.([250, 120, 250]);
    } else if (closeVehicles.length === 0) {
      setNearbyAlert("");
    } else {
      setNearbyAlert("มีรถที่แชร์ตำแหน่งอยู่ภายใน 500 เมตร จำนวน " + closeVehicles.length + " คัน");
    }
  }, [sharing, position, vehicles]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(()=>{if(!position||!closeHazards.length){setHazardAlert("");announcedHazards.current.clear();return;}const h=closeHazards[0];setHazardAlert("ระวัง "+hazardLabels[h.type]+" อยู่ห่างประมาณ "+Math.round(h.distance)+" เมตร"+(h.note?" · "+h.note:""));if(!announcedHazards.current.has(h.id)){announcedHazards.current.add(h.id);if(voiceOn)speakThai("คำเตือน "+hazardLabels[h.type]+" อยู่ห่างประมาณ "+Math.round(h.distance)+" เมตร");if("vibrate" in navigator)navigator.vibrate?.([300,100,300]);}},[position,hazards,voiceOn]);
  const reportHazard=async()=>{if(!position){setNotice("กรุณารับตำแหน่ง GPS ก่อนรายงานเหตุ");return;}setHazardBusy(true);try{const r=await fetch("/api/hazards",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({lat:position.lat,lng:position.lng,type:hazardType,note:hazardNote.trim().slice(0,120)})});const d=await r.json() as {hazard?:Hazard;error?:string};if(!r.ok||!d.hazard)throw new Error(d.error||"ส่งรายงานไม่สำเร็จ");setHazards(old=>[d.hazard!,...old]);setHazardNote("");setNotice("ส่งรายงานเหตุแล้ว");if(voiceOn)speakThai("ส่งรายงาน"+hazardLabels[hazardType]+"แล้ว");}catch(e){setNotice(e instanceof Error?e.message:"ส่งรายงานไม่สำเร็จ");}finally{setHazardBusy(false);}};
  const searchRoute = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!origin.trim() || !destination.trim()) { setRouteError("กรุณากรอกจุดเริ่มต้นและปลายทาง"); return; }
    setRouteBusy(true); setRouteError(""); setRouteSummary(""); setRouteSteps([]); setRouteOptions([]); setSelectedRouteIndex(0); setCurrentStep(0); announcedStep.current=-1;
    try {
      const start = originPoint || (origin.trim().toLowerCase() === "ตำแหน่งของฉัน" && position ? { lat: position.lat, lng: position.lng } : await geocode(origin.trim()));
      const end = destinationPoint || await geocode(destination.trim());
      const url = "https://router.project-osrm.org/route/v1/driving/" + start.lng + "," + start.lat + ";" + end.lng + "," + end.lat + "?overview=full&steps=true&alternatives=true&geometries=geojson";
      const response = await fetch(url);
      if (!response.ok) throw new Error("บริการคำนวณเส้นทางไม่พร้อมใช้งาน");
      const result = await response.json() as { code: string; routes?: RouteResult[] };
      if (result.code !== "Ok" || !result.routes?.length) throw new Error("ไม่พบเส้นทางขับรถระหว่างสองจุดนี้");
      const route = result.routes[0];
      setOriginPoint(start);
      setDestinationPoint(end);
      setRouteOptions(result.routes);
      setSelectedRouteIndex(0);
      const points = route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
      setRoutePoints(points);
      setRouteSteps((route.legs||[]).flatMap(l=>l.steps).filter(s=>s.maneuver?.location));
      setRouteSummary("ระยะทางประมาณ " + (route.distance / 1000).toFixed(1) + " กม. · ใช้เวลาประมาณ " + Math.max(1, Math.round(route.duration / 60)) + " นาที");
      if(voiceOn&&route.legs?.[0]?.steps?.[0])speakThai("เริ่มนำทาง "+stepText(route.legs[0].steps[0]));
    } catch (error) {
      setRouteError(error instanceof Error ? error.message : "ค้นหาเส้นทางไม่สำเร็จ");
      setRoutePoints([]);
    } finally { setRouteBusy(false); }
  };

  useEffect(()=>{if(!position||!routeSteps.length)return;let best=currentStep,dist=Infinity;for(let i=currentStep;i<routeSteps.length;i++){const loc=routeSteps[i].maneuver.location;const d=distanceMeters(position,{lat:loc[1],lng:loc[0]});if(d<dist){dist=d;best=i;}}if(best>currentStep&&dist<100){setCurrentStep(best);if(voiceOn&&announcedStep.current!==best){announcedStep.current=best;speakThai(stepText(routeSteps[best]));}}},[position,routeSteps,currentStep,voiceOn]);
  const chooseRoute = (route: RouteResult, index: number) => {
    setSelectedRouteIndex(index);
    setRoutePoints(route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })));
    const steps = (route.legs || []).flatMap(leg => leg.steps).filter(step => step.maneuver?.location);
    setRouteSteps(steps);
    setCurrentStep(0);
    announcedStep.current = -1;
    setRouteSummary("ระยะทางประมาณ " + (route.distance / 1000).toFixed(1) + " กม. · ใช้เวลาประมาณ " + Math.max(1, Math.round(route.duration / 60)) + " นาที");
    if (voiceOn && steps[0]) speakThai("เริ่มนำทาง " + stepText(steps[0]));
  };

  const routeStart = routePoints[0];
  const routeEnd = routePoints[routePoints.length - 1];

  return <main className="app-shell">
    <header className="topbar"><div className="brand-mark"><Radio size={21} /></div><div><h1>Road Alert</h1><p>ค้นหาเส้นทางและแจ้งเตือนรถใกล้เคียง · รุ่นทดลอง</p></div><span className="trial-badge">ทดลองใช้</span><button className="mobile-menu-trigger" aria-label="เปิดเมนู" onClick={()=>setMobileMenuOpen(true)}><Menu size={21}/><span>เมนู</span></button></header>
    <div className="navigation-layout">
    <section className="route-panel">
      <div className="route-heading"><RouteIcon size={20}/><div><h2>ค้นหาเส้นทาง</h2><p>กรอกจุดเริ่มต้นและปลายทาง แล้วกดค้นหา</p></div></div>
      <form className="route-form" onSubmit={searchRoute}>
        <label>จาก<input value={origin} onChange={e => { setOrigin(e.target.value); setOriginPoint(null); }} placeholder="เช่น ตำแหน่งของฉัน หรือ เชียงใหม่" /></label>
        <label>ไปยัง<input value={destination} onChange={e => { setDestination(e.target.value); setDestinationPoint(null); }} placeholder="เช่น แม่ฮ่องสอน" /></label>
        <button type="submit" className="route-btn" disabled={routeBusy}><Navigation size={17}/>{routeBusy ? "กำลังค้นหา..." : "ค้นหาเส้นทาง"}</button>
      </form>
      {routeSummary && <p className="route-summary">{routeSummary} <span>· เส้นทางจากข้อมูลแผนที่ ไม่ใช่คำแนะนำจราจรสด</span></p>}
      {routeError && <p className="route-error"><AlertTriangle size={15}/>{routeError}</p>}
      {routeOptions.length > 0 && <div className="route-options"><h3>เลือกเส้นทาง</h3>{routeOptions.map((route,index)=><button type="button" key={index} className={selectedRouteIndex===index?"route-option selected":"route-option"} onClick={()=>chooseRoute(route,index)}><span className="route-option-icon"><Navigation size={18}/></span><span className="route-option-main"><strong>{Math.max(1,Math.round(route.duration/60))} นาที</strong><small>{(route.distance/1000).toFixed(1)} กม. · {index===0?"เส้นทางแนะนำ":"เส้นทางทางเลือก "+(index+1)}</small></span>{selectedRouteIndex===index&&<span className="route-option-check">เลือกแล้ว</span>}</button>)}</div>}
      <div className="map-pick-controls"><span>หรือเลือกจุดจากแผนที่</span><button type="button" className={pickTarget==="origin"?"pick-btn selected":"pick-btn"} onClick={()=>setPickTarget(pickTarget==="origin"?null:"origin")}><MapPin size={15}/>เลือกจุดเริ่มต้น</button><button type="button" className={pickTarget==="destination"?"pick-btn selected":"pick-btn"} onClick={()=>setPickTarget(pickTarget==="destination"?null:"destination")}><MapPin size={15}/>เลือกปลายทาง</button>{pickTarget&&<small>แตะตำแหน่งบนแผนที่เพื่อกำหนด{pickTarget==="origin"?"จุดเริ่มต้น":"ปลายทาง"}</small>}</div>
      <div className="navigation-controls"><button className={voiceOn?"voice-btn active":"voice-btn"} onClick={()=>{const n=!voiceOn;setVoiceOn(n);if(!n)window.speechSynthesis?.cancel();else if(routeSteps[currentStep])speakThai(stepText(routeSteps[currentStep]));}}><Volume2 size={17}/>{voiceOn?"เสียงภาษาไทยเปิด":"เปิดเสียงนำทาง"}</button>{routeSteps.length>0&&<div className="next-turn"><Navigation size={18}/><div><small>คำสั่งถัดไป</small><strong>{stepText(routeSteps[Math.min(currentStep+1,routeSteps.length-1)])}</strong></div><button onClick={()=>speakThai(stepText(routeSteps[Math.min(currentStep+1,routeSteps.length-1)]))} aria-label="ฟังคำสั่ง"><Volume2 size={16}/></button></div>}</div>
    </section>
    <section className="map-wrap">
      <RoadMap mapLayer={mapLayer} position={position} originPoint={originPoint} destinationPoint={destinationPoint} routePoints={routePoints} sharing={sharing} vehicles={nearby} hazards={hazards} pickTarget={pickTarget} onPick={(point,target)=>{if(target==="origin"){setOriginPoint(point);setOrigin("จุดที่เลือกบนแผนที่");}else{setDestinationPoint(point);setDestination("จุดที่เลือกบนแผนที่");}setPickTarget(null);setRouteError("");setNotice("เลือกตำแหน่งจากแผนที่แล้ว");}} onMovePin={(point,target)=>{if(target==="origin"){setOriginPoint(point);setOrigin("จุดเริ่มต้นที่ย้ายหมุด");}else{setDestinationPoint(point);setDestination("ปลายทางที่ย้ายหมุด");}setRoutePoints([]);setRouteOptions([]);setRouteSummary("");setNotice("ย้ายหมุดแล้ว กดค้นหาเส้นทางอีกครั้ง");}} />
      <div className="map-tools"><button className="map-tool-btn" onClick={()=>setMapLayer(mapLayer==="standard"?"satellite":"standard")}><Layers size={17}/>{mapLayer==="standard"?"ภาพดาวเทียม 3D":"แผนที่ถนน 3D"}</button><button className="locate-btn" onClick={locate} disabled={busy}><LocateFixed size={18}/>{busy ? "กำลังค้นหา..." : "ตำแหน่งของฉัน"}</button></div>
      <div className="map-caption"><MapPin size={15}/>{gpsMessage}</div>
    </section>
    </div>
    {mobileMenuOpen && <div className="mobile-menu-backdrop" onClick={() => setMobileMenuOpen(false)}><section className="mobile-menu-sheet" role="dialog" aria-modal="true" aria-label="เมนู Road Alert" onClick={e => e.stopPropagation()}><div className="mobile-menu-head"><div><strong>เมนู Road Alert</strong><small>เลือกเครื่องมือที่ต้องการ</small></div><button aria-label="ปิดเมนู" onClick={() => setMobileMenuOpen(false)}><X size={21}/></button></div><button className="menu-action" onClick={() => {setMobileMenuOpen(false);document.querySelector(".route-panel")?.scrollIntoView({behavior:"smooth",block:"start"});}}><Navigation size={19}/>ค้นหาเส้นทาง</button><button className="menu-action" onClick={() => {setMapLayer("standard");setMobileMenuOpen(false);}}><Layers size={19}/>แผนที่ถนน {mapLayer==="standard"?"✓":""}</button><button className="menu-action" onClick={() => {setMapLayer("satellite");setMobileMenuOpen(false);}}><Satellite size={19}/>ภาพถ่ายดาวเทียม {mapLayer==="satellite"?"✓":""}</button><button className="menu-action" onClick={() => {setMobileMenuOpen(false);locate();}}><LocateFixed size={19}/>ตำแหน่งของฉัน</button><button className="menu-action" onClick={() => {setMobileMenuOpen(false);document.querySelector(".share-panel")?.scrollIntoView({behavior:"smooth",block:"start"});}}><Radio size={19}/>{sharing?"สถานะการแชร์ตำแหน่ง":"แชร์ตำแหน่งรถ"}</button><button className="menu-action" onClick={() => {setMobileMenuOpen(false);document.querySelector(".hazard-panel")?.scrollIntoView({behavior:"smooth",block:"start"});}}><AlertTriangle size={19}/>รายงานเหตุอันตราย</button><div className="menu-note"><Box size={17}/><span>แผนที่ใช้มุมเอียง 3D และแสดงอาคารเมื่อผู้ให้บริการมีข้อมูลรองรับ</span></div></section></div>}
    <section className="content">
      <div className="panel share-panel">
        <div className="panel-title"><div><h2>แชร์ตำแหน่งรถ</h2><p>ไม่มีบัญชีผู้ใช้ · เปิดแชร์เมื่อคุณยินยอมเท่านั้น</p></div><ShieldCheck size={24}/></div>
        {!sharing ? <button className="primary-btn" onClick={startSharing}><Radio size={18}/>ยินยอมและเริ่มแชร์ตำแหน่ง</button> : <button className="stop-btn" onClick={stopSharing}><Square size={16} fill="currentColor"/>หยุดแชร์ตำแหน่งทันที</button>}
        <p className="privacy-note">เมื่อเปิดแชร์ ระบบจะส่งตำแหน่ง GPS และความเร็ว (ถ้าอุปกรณ์ให้ข้อมูล) ไปยัง Cloudflare เพื่อแสดงรถที่เข้าร่วม ข้อมูลจะหมดอายุอัตโนมัติภายใน 2 นาทีหลังไม่มีการอัปเดต การกดหยุดแชร์จะพยายามลบข้อมูลทันที</p>
        {notice && <div className="notice"><AlertTriangle size={16}/>{notice}</div>}
        {nearbyAlert && <div className="proximity-alert" role="status"><AlertTriangle size={19}/><span>{nearbyAlert}<small>เฉพาะอุปกรณ์ที่แชร์ตำแหน่งกับระบบนี้</small></span></div>}
        {hazardAlert && <div className="proximity-alert hazard-alert" role="alert"><Siren size={19}/><span>{hazardAlert}<small>รายงานผู้ใช้อาจคลาดเคลื่อนหรือหมดอายุแล้ว</small></span></div>}
      </div>
      <div className="panel hazard-panel"><div className="panel-title"><div><h2>รายงานเหตุอันตราย</h2><p>แจ้งเหตุ ณ ตำแหน่ง GPS ปัจจุบัน</p></div><Siren size={24}/></div><label className="hazard-label">ประเภทเหตุ<select value={hazardType} onChange={e=>setHazardType(e.target.value as HazardType)}><option value="accident">อุบัติเหตุ</option><option value="broken_vehicle">รถเสีย</option><option value="obstacle">สิ่งกีดขวาง</option><option value="road_hazard">อันตรายบนถนน</option></select></label><label className="hazard-label">รายละเอียด (ไม่บังคับ)<input value={hazardNote} maxLength={120} onChange={e=>setHazardNote(e.target.value)} placeholder="เช่น รถจอดเสียในช่องทางซ้าย"/></label><button className="report-btn" onClick={reportHazard} disabled={hazardBusy}><AlertTriangle size={17}/>{hazardBusy?"กำลังส่งรายงาน...":"รายงานเหตุ ณ ตำแหน่งฉัน"}</button><p className="privacy-note">รายงานหมดอายุใน 30 นาที ยังไม่มีระบบยืนยันความถูกต้อง</p></div>
      <div className="panel status-panel"><div className="panel-title"><div><h2>รถที่รายงานตำแหน่ง</h2><p>แสดงเฉพาะรถที่แชร์ตำแหน่งสดและข้อมูลยังไม่หมดอายุ</p></div><span className="count">{sharing ? nearby.length : "—"}</span></div>
        {!sharing ? <p className="empty">เปิดโหมดแชร์ตำแหน่งเพื่อทดลองดูรถที่เข้าร่วมระบบ</p> : nearby.length ? nearby.slice(0,8).map(v => <div className={"vehicle-row " + (v.distance <= 500 ? "vehicle-near" : "")} key={v.id}><span className="vehicle-icon">🚘</span><div className="vehicle-info"><strong>{v.distance <= 500 ? "รถใกล้เคียง · ระวัง" : "รถที่เข้าร่วม"}</strong><small>อัปเดต {Math.max(0,Math.round((Date.now()-v.updatedAt)/1000))} วินาทีที่แล้ว</small></div><strong>{v.distance < 1000 ? Math.round(v.distance)+" ม." : (v.distance/1000).toFixed(1)+" กม."}</strong></div>) : <p className="empty">ยังไม่มีรถคันอื่นรายงานตำแหน่งในขณะนี้</p>}
      </div>
      <div className="panel status-panel"><div className="panel-title"><div><h2>เหตุอันตรายใกล้เคียง</h2><p>รายงานภายใน 30 นาทีที่ผ่านมา</p></div><span className="count">{hazards.length}</span></div>{nearbyHazards.length?nearbyHazards.slice(0,5).map(h=><div className="vehicle-row" key={h.id}><span className="vehicle-icon">{h.type==="accident"?"🚨":h.type==="broken_vehicle"?"🚗":h.type==="obstacle"?"🪨":"⚠️"}</span><div className="vehicle-info"><strong>{hazardLabels[h.type]}</strong><small>{Math.round(h.distance)} เมตร · {Math.max(0,Math.round((Date.now()-h.createdAt)/60000))} นาทีที่แล้ว{h.note?" · "+h.note:""}</small></div></div>):<p className="empty">ยังไม่มีรายงานเหตุใกล้ตำแหน่งของคุณ</p>}</div>
      <div className="safety"><AlertTriangle size={19}/><p><strong>ข้อควรทราบ:</strong> รุ่นทดลองนี้ไม่รับประกันการตรวจจับรถทุกคัน รถที่ไม่แชร์ตำแหน่งจะไม่ปรากฏ และรายงานเหตุอาจไม่ครบถ้วนหรือไม่ถูกต้อง เสียงนำทางไม่มีข้อมูลจราจรสด กรุณาอย่าใช้โทรศัพท์ขณะขับรถ</p></div>
    </section>
    <footer>Road Alert · รุ่นทดลอง · ตำแหน่งของคุณจะถูกส่งเมื่อคุณเปิดแชร์เท่านั้น</footer>
  </main>;
}
