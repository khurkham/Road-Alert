import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import maplibregl, { type Map as MapLibreMap, type Marker as MapLibreMarker, type GeoJSONSource } from "maplibre-gl";
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
const ROAD_FALLBACK_TILES = "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png";
type RoadMapProps = {
  mapLayer: "standard" | "satellite"; driveMode: boolean; position: Position | null; onMapError: (message: string) => void; originPoint: RoutePoint | null; destinationPoint: RoutePoint | null;
  routePoints: RoutePoint[]; sharing: boolean; vehicles: Vehicle[]; hazards: Hazard[]; pickTarget: "origin" | "destination" | null;
  onPick: (point: RoutePoint, target: "origin" | "destination") => void;
  onMovePin: (point: RoutePoint, target: "origin" | "destination") => void;
};
function RoadMap({mapLayer,driveMode,position,onMapError,originPoint,destinationPoint,routePoints,sharing,vehicles,hazards,pickTarget,onPick,onMovePin}:RoadMapProps) {
  const host=useRef<HTMLDivElement|null>(null), mapRef=useRef<MapLibreMap|null>(null), markersRef=useRef<MapLibreMarker[]>([]);
  const [styleReady,setStyleReady]=useState(false);
  const propsRef=useRef({position,originPoint,destinationPoint,routePoints,sharing,vehicles,hazards,pickTarget,onPick,onMovePin,mapLayer,onMapError});
  propsRef.current={position,originPoint,destinationPoint,routePoints,sharing,vehicles,hazards,pickTarget,onPick,onMovePin,mapLayer,onMapError};
  const setupStyle=useCallback((map:MapLibreMap, layer:"standard"|"satellite")=>{
    if(!map.isStyleLoaded())return;
    if(layer==="satellite"){
      if(map.getLayer("road-alert-road-fallback-layer"))map.setLayoutProperty("road-alert-road-fallback-layer","visibility","none");
      if(!map.getSource("road-alert-satellite")){
        map.addSource("road-alert-satellite",{type:"raster",tiles:[SATELLITE_TILES],tileSize:256,maxzoom:19,attribution:"Imagery © Esri"});
        const layers=map.getStyle().layers||[];
        const firstLayer=layers[0]?.id;
        map.addLayer({id:"road-alert-satellite-layer",type:"raster",source:"road-alert-satellite",paint:{"raster-opacity":0.78}},firstLayer);
      }
      map.getStyle().layers?.forEach(l=>{if(l.type==="fill"&&!l.id.includes("building")){try{map.setPaintProperty(l.id,"fill-opacity",0.12)}catch{}}});
    }else{
      if(map.getLayer("road-alert-road-fallback-layer"))map.setLayoutProperty("road-alert-road-fallback-layer","visibility","none");
      if(map.getLayer("road-alert-satellite-layer"))map.removeLayer("road-alert-satellite-layer");
      if(map.getSource("road-alert-satellite"))map.removeSource("road-alert-satellite");
      map.getStyle().layers?.forEach(l=>{if(l.type==="fill"&&!l.id.includes("building")){try{map.setPaintProperty(l.id,"fill-opacity",1)}catch{}}});
    }
    if(!map.getSource("road-alert-road-fallback")){
      map.addSource("road-alert-road-fallback",{type:"raster",tiles:[ROAD_FALLBACK_TILES],tileSize:256,maxzoom:20,attribution:"© OpenStreetMap contributors © CARTO"});
      const firstSymbol=map.getStyle().layers?.find(l=>l.type==="symbol")?.id;
      map.addLayer({id:"road-alert-road-fallback-layer",type:"raster",source:"road-alert-road-fallback",layout:{visibility:"none"},paint:{"raster-opacity":1}},firstSymbol);
    }
    if(!map.getSource("road-alert-route")){
      map.addSource("road-alert-route",{type:"geojson",data:{type:"Feature",properties:{},geometry:{type:"LineString",coordinates:[]} }});
      map.addLayer({id:"road-alert-route-line",type:"line",source:"road-alert-route",layout:{"line-join":"round","line-cap":"round"},paint:{"line-color":"#087fce","line-width":["interpolate",["linear"],["zoom"],10,4,16,8,19,11],"line-opacity":1}});
    }
    if(!map.getLayer("road-alert-3d-buildings")&&map.getSource("openmaptiles")){
      try{map.addLayer({id:"road-alert-3d-buildings",source:"openmaptiles","source-layer":"building",type:"fill-extrusion",minzoom:13,filter:["all",["!=",["get","hide_3d"],true]],paint:{"fill-extrusion-color":["coalesce",["get","render_colour"],["get","colour"],"#aeb8c1"],"fill-extrusion-height":["interpolate",["linear"],["zoom"],13,0,15,["coalesce",["get","render_height"],["get","height"],8]],"fill-extrusion-base":["coalesce",["get","render_min_height"],["get","min_height"],0],"fill-extrusion-opacity":0.82}})}catch{/* style may not expose building source */}}
  },[]);
  useEffect(()=>{
    if(!host.current||mapRef.current)return;
    const map=new maplibregl.Map({container:host.current,style:STREET_STYLE,center:[97.97,19.3],zoom:9,pitch:driveMode?62:48,bearing:0, maxPitch:70});
    mapRef.current=map;
    map.addControl(new maplibregl.NavigationControl({visualizePitch:true}),"bottom-right");
    map.on("style.load",()=>{setupStyle(map,propsRef.current.mapLayer);setStyleReady(true);});
    map.on("error",event=>{
      const detail=event as unknown as {sourceId?:string;error?:{message?:string}};
      const sourceId=detail.sourceId||"";
      if(sourceId==="road-alert-satellite"){
        propsRef.current.onMapError("ภาพดาวเทียมโหลดไม่สำเร็จ กำลังแสดงแผนที่ถนนแทน");
        if(map.getLayer("road-alert-satellite-layer"))map.setLayoutProperty("road-alert-satellite-layer","visibility","none");
      }
      if(sourceId==="openmaptiles"||sourceId==="road-alert-satellite"){
        if(map.getLayer("road-alert-road-fallback-layer"))map.setLayoutProperty("road-alert-road-fallback-layer","visibility","visible");
        propsRef.current.onMapError("แผนที่หลักโหลดข้อมูลถนนไม่ครบ กำลังเปิดแผนที่ถนนสำรอง");
      }
    });
    map.on("click",e=>{const p=propsRef.current;if(p.pickTarget)p.onPick({lat:e.lngLat.lat,lng:e.lngLat.lng},p.pickTarget);});
    return()=>{markersRef.current.forEach(m=>m.remove());markersRef.current=[];map.remove();mapRef.current=null;};
  },[setupStyle]);
  useEffect(()=>{const map=mapRef.current;if(!map)return;const apply=()=>setupStyle(map,mapLayer);if(map.isStyleLoaded())apply();else map.once("style.load",apply);},[mapLayer,setupStyle]);
  useEffect(()=>{const map=mapRef.current;if(!map)return;const source=map.getSource("road-alert-route") as GeoJSONSource|undefined;if(source)source.setData({type:"Feature",properties:{},geometry:{type:"LineString",coordinates:routePoints.map(p=>[p.lng,p.lat])}});if(routePoints.length>1)map.fitBounds(new maplibregl.LngLatBounds([routePoints[0].lng,routePoints[0].lat],[routePoints[routePoints.length-1].lng,routePoints[routePoints.length-1].lat]),{padding:55,maxZoom:16});},[routePoints]);
  useEffect(()=>{const map=mapRef.current;if(!map||!position)return;map.easeTo({center:[position.lng,position.lat],zoom:Math.max(map.getZoom(),driveMode?17:15),pitch:driveMode?62:48,bearing:driveMode&&position.heading!==null?position.heading:0,duration:500});},[position?.lat,position?.lng,position?.heading,driveMode]);
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
    vehicles.filter(v=>Date.now()-v.updatedAt<120000).forEach(v=>add(v,"🚘","map-marker-car"));
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
type PlaceSuggestion = { lat: number; lng: number; label: string; name: string };
async function searchPlaces(query: string, near?: RoutePoint | null): Promise<PlaceSuggestion[]> {
  // Expand broad Thai categories so short searches such as "สนาม" return useful choices.
  const normalized = query.trim();
  const expansions: Record<string, string[]> = {
    "สนาม": ["สนามกีฬา", "สนามฟุตบอล", "สนามเด็กเล่น", "สนามบิน", "สนามเทนนิส"],
    "ตลาด": ["ตลาดสด", "ตลาดนัด", "ตลาด"],
    "วัด": ["วัด", "สำนักสงฆ์"],
    "โรงเรียน": ["โรงเรียน", "สถานศึกษา"],
    "โรงพยาบาล": ["โรงพยาบาล", "คลินิก"]
  };
  const terms = Array.from(new Set([normalized, ...(expansions[normalized] || [])]));
  const fetchTerm = async (term: string) => {
    const url = new URL("https://photon.komoot.io/api/");
    url.searchParams.set("q", term);
    url.searchParams.set("limit", "12");
    url.searchParams.set("lang", "th");
    if (near && Number.isFinite(near.lat) && Number.isFinite(near.lng)) {
      url.searchParams.set("lat", String(near.lat));
      url.searchParams.set("lon", String(near.lng));
      url.searchParams.set("zoom", "12");
    }
    const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("บริการค้นหาสถานที่ตอบกลับ " + response.status);
    const data = await response.json() as { features?: Array<{ geometry?: { coordinates?: [number, number] }; properties?: { name?: string; street?: string; district?: string; city?: string; county?: string; state?: string; country?: string } }> };
    return (data.features || []).flatMap(feature => {
      const coordinates = feature.geometry?.coordinates;
      const p = feature.properties;
      if (!coordinates || !p || !Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1])) return [];
      const name = p.name || p.street || "สถานที่";
      const context = [p.street && p.street !== name ? p.street : "", p.district, p.city || p.county, p.state, p.country].filter(Boolean);
      return [{ lng: coordinates[0], lat: coordinates[1], name, label: [name, ...Array.from(new Set(context))].join(", ") }];
    });
  };
  const results = await Promise.allSettled(terms.map(fetchTerm));
  const places = results.flatMap(result => result.status === "fulfilled" ? result.value : []);
  if (!places.length && results.every(result => result.status === "rejected")) {
    throw new Error("เชื่อมต่อบริการค้นหาสถานที่ไม่ได้ กรุณาลองใหม่อีกครั้ง");
  }
  const unique = places.filter((place, index, list) => list.findIndex(other => other.label === place.label) === index);
  if (near) unique.sort((a, b) => distanceMeters(near, a) - distanceMeters(near, b));
  return unique.slice(0, 12);
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
  const [mapNotice, setMapNotice] = useState("");
  const [mapLayer, setMapLayer] = useState<"standard" | "satellite">("standard");
  const [driveMode, setDriveMode] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [waypoints, setWaypoints] = useState<string[]>([]);
  const [navigationMode, setNavigationMode] = useState(false);
  const [pickTarget, setPickTarget] = useState<"origin" | "destination" | null>(null);
  const [originPoint, setOriginPoint] = useState<RoutePoint | null>(null);
  const [originSuggestions, setOriginSuggestions] = useState<PlaceSuggestion[]>([]);
  const [destinationSuggestions, setDestinationSuggestions] = useState<PlaceSuggestion[]>([]);
  const [activeSearchField, setActiveSearchField] = useState<"origin" | "destination" | null>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
   const [suggestionError, setSuggestionError] = useState("");
  const [destinationPoint, setDestinationPoint] = useState<RoutePoint | null>(null);
  const [routePoints, setRoutePoints] = useState<RoutePoint[]>([]);
  const [routeOptions, setRouteOptions] = useState<RouteResult[]>([]);
  useEffect(() => {
    const query = activeSearchField === "origin" ? origin.trim() : activeSearchField === "destination" ? destination.trim() : "";
    const setSuggestions = activeSearchField === "origin" ? setOriginSuggestions : setDestinationSuggestions;
    if (query.length < 2 || query.toLowerCase() === "ตำแหน่งของฉัน" || (activeSearchField === "origin" && originPoint) || (activeSearchField === "destination" && destinationPoint)) { setSuggestions([]); setSuggestionsLoading(false); setSuggestionError(""); return; }
    let cancelled = false;
    setSuggestions([]);
    setSuggestionsLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const places = await searchPlaces(query, position ? { lat: position.lat, lng: position.lng } : null);
        if (!cancelled) setSuggestions(places);
      } catch (error) {
        if (!cancelled) {
          setSuggestions([]);
          setSuggestionError(error instanceof Error ? error.message : "เชื่อมต่อบริการค้นหาสถานที่ไม่ได้ กรุณาลองใหม่อีกครั้ง");
        }
      } finally {
        if (!cancelled) setSuggestionsLoading(false);
      }
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [origin, destination, activeSearchField, originPoint, destinationPoint, position?.lat, position?.lng]);

  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [routeSummary, setRouteSummary] = useState("");
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [nearbyAlert, setNearbyAlert] = useState("");
  const [hazards,setHazards]=useState<Hazard[]>([]); const [hazardType,setHazardType]=useState<HazardType>("accident"); const [hazardNote,setHazardNote]=useState(""); const [hazardBusy,setHazardBusy]=useState(false); const [hazardAlert,setHazardAlert]=useState(""); const [voiceOn,setVoiceOn]=useState(true); const [routeSteps,setRouteSteps]=useState<RouteStep[]>([]); const [currentStep,setCurrentStep]=useState(0); const announcedStep=useRef(-1); const announcedHazards=useRef<Set<string>>(new Set());
  const watchId = useRef<number | null>(null);
  const sessionId = useRef<string>((() => {
    // Keep one stable anonymous vehicle ID on this browser so a page refresh
    // does not make the same phone appear as a second nearby vehicle.
    const key = "road-alert-device-id";
    try {
      const saved = window.localStorage.getItem(key);
      if (saved && /^[A-Za-z0-9-]{20,50}$/.test(saved)) return saved;
      const created = crypto.randomUUID();
      window.localStorage.setItem(key, created);
      return created;
    } catch {
      return crypto.randomUUID();
    }
  })());
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
      const middle = await Promise.all(waypoints.filter(v=>v.trim()).map(v=>geocode(v.trim())));
      const stops = [start, ...middle, end];
      const legs = await Promise.all(stops.slice(0,-1).map(async (point,index)=>{
        const next=stops[index+1];
        const url="https://router.project-osrm.org/route/v1/driving/"+point.lng+","+point.lat+";"+next.lng+","+next.lat+"?overview=full&steps=true&geometries=geojson";
        const response=await fetch(url);
        if(!response.ok)throw new Error("บริการคำนวณเส้นทางไม่พร้อมใช้งาน");
        const result=await response.json() as {code:string;routes?:RouteResult[]};
        if(result.code!=="Ok"||!result.routes?.length)throw new Error("ไม่พบเส้นทางช่วงที่ "+(index+1)+" กรุณาตรวจสอบจุดพัก");
        return result.routes[0];
      }));
      const route:RouteResult={distance:legs.reduce((n,r)=>n+r.distance,0),duration:legs.reduce((n,r)=>n+r.duration,0),geometry:{coordinates:legs.flatMap((r,i)=>i?r.geometry.coordinates.slice(1):r.geometry.coordinates)},legs:legs.flatMap(r=>r.legs||[])};
      const routes=[route];
      setOriginPoint(start);
      setDestinationPoint(end);
      setRouteOptions(routes);
      setSelectedRouteIndex(0);
      const points = route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
      setRoutePoints(points);
      setRouteSteps((route.legs||[]).flatMap(l=>l.steps).filter(s=>s.maneuver?.location));
      setRouteSummary("ระยะทางประมาณ " + (route.distance / 1000).toFixed(1) + " กม. · ใช้เวลาประมาณ " + Math.max(1, Math.round(route.duration / 60)) + " นาที");
      if(voiceOn&&route.legs?.[0]?.steps?.[0])speakThai("เริ่มนำทาง "+stepText(route.legs[0].steps[0]));
      setNavigationMode(false);
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
    <header className="topbar"><div className="brand-mark"><Radio size={21} /></div><div><h1>Road Alert</h1><p>นำทาง 3D และแจ้งเตือนรถใกล้เคียง</p></div><button type="button" className="topbar-menu-btn" onClick={() => setMobileMenuOpen(true)}><Menu size={18}/> เมนู</button><span className="trial-badge">Road Alert</span></header>
    <section className="welcome-banner" aria-label="แนะนำ Road Alert">
      <div className="welcome-copy"><span className="welcome-eyebrow">เดินทางอย่างรู้ทัน · ช่วยกันรายงาน</span><h2>เห็นเส้นทาง รู้เหตุใกล้ตัว เดินทางอย่างมั่นใจ</h2><p>เปิดแผนที่ 3D ค้นหาเส้นทาง แชร์ตำแหน่งรถ และแจ้งเหตุบนถนนได้จากมือถือหรือคอมพิวเตอร์ ช่วยกันแบ่งปันข้อมูลให้ผู้ร่วมทางรับรู้มากขึ้น</p></div>
      <div className="welcome-actions"><button type="button" onClick={() => setMobileMenuOpen(true)}><RouteIcon size={17}/> เริ่มค้นหาเส้นทาง</button><a href="#road-alert-map">ดูแผนที่</a></div>
      <p className="welcome-note"><ShieldCheck size={14}/> แชร์ตำแหน่งเมื่อคุณยินยอมเท่านั้น · ใช้งานผ่านเว็บได้</p>
    </section>
    <div className="navigation-layout">
    <section className="map-wrap" id="road-alert-map">
      <RoadMap mapLayer={mapLayer} driveMode={driveMode} position={position} onMapError={message=>{setMapNotice(message);setMapLayer("standard");}} originPoint={originPoint} destinationPoint={destinationPoint} routePoints={routePoints} sharing={sharing} vehicles={nearby} hazards={hazards} pickTarget={pickTarget} onPick={(point,target)=>{if(target==="origin"){setOriginPoint(point);setOrigin("จุดที่เลือกบนแผนที่");}else{setDestinationPoint(point);setDestination("จุดที่เลือกบนแผนที่");}setPickTarget(null);setRouteError("");setNotice("เลือกตำแหน่งจากแผนที่แล้ว");}} onMovePin={(point,target)=>{if(target==="origin"){setOriginPoint(point);setOrigin("จุดเริ่มต้นที่ย้ายหมุด");}else{setDestinationPoint(point);setDestination("ปลายทางที่ย้ายหมุด");}setRoutePoints([]);setRouteOptions([]);setRouteSummary("");setNotice("ย้ายหมุดแล้ว กดค้นหาเส้นทางอีกครั้ง");}} />
      <div className="map-tools"><button className="map-tool-btn" onClick={()=>setDriveMode(v=>!v)}><Navigation size={17}/>{driveMode?"มุมมองแผนที่":"มุมมองบนรถ"}</button><button className="map-tool-btn" onClick={()=>{setMapNotice("");setMapLayer(mapLayer==="standard"?"satellite":"standard");}}><Layers size={17}/>{mapLayer==="standard"?"ภาพดาวเทียม 3D":"แผนที่ถนน 3D"}</button><button className="locate-btn" onClick={locate} disabled={busy}><LocateFixed size={18}/>{busy ? "กำลังค้นหา..." : "ตำแหน่งของฉัน"}</button></div>{driveMode&&<div className="drive-hud"><div><strong>{position?.speed!==null&&position?.speed!==undefined&&position.speed>=0?Math.round(position.speed*3.6):"--"}</strong><small>กม./ชม.</small></div><span>{position?`GPS ±${Math.round(position.accuracy)} ม.`:"รอสัญญาณ GPS"}</span></div>}
      {navigationMode&&routeSteps.length>0&&<div className="navigation-mode-banner"><div className="nav-turn-icon"><Navigation size={32}/><small>{Math.round(routeSteps[currentStep]?.distance||0)} ม.</small></div><div className="nav-turn-copy"><strong>{stepText(routeSteps[currentStep])}</strong><small>{routeSummary}</small></div></div>}
      {navigationMode&&<div className="navigation-mode-bottom"><div><strong>{routeSummary||"กำลังนำทาง"}</strong><small>{position?.speed!=null?Math.round(position.speed*3.6)+" กม./ชม.":"รอข้อมูลความเร็ว GPS"}</small></div><button onClick={()=>{setNavigationMode(false);setDriveMode(false);window.speechSynthesis?.cancel();}}>จบการนำทาง</button></div>}
      <button className="map-menu-trigger" aria-label="เปิดเมนู Road Alert" onClick={()=>setMobileMenuOpen(true)}><Menu size={18}/> เมนู</button>
      <div className="map-traffic-status" role="status"><div className="traffic-count"><strong>{nearby.length}</strong><span>รถที่แชร์ตำแหน่ง</span></div><div className="traffic-count"><strong>{nearbyHazards.length}</strong><span>เหตุอันตราย</span></div>{nearby.length>0&&<div className="traffic-nearest"><strong>รถใกล้สุด {Math.round(nearby[0].distance)} ม.</strong><span>{nearby[0].speed!==null&&nearby[0].speed>=0?"ความเร็ว "+Math.round(nearby[0].speed*3.6)+" กม./ชม.":"ความเร็วไม่พร้อมใช้งาน"}</span></div>}</div>
      {mapNotice&&<button className="map-fallback-notice" onClick={()=>setMapNotice("")}><AlertTriangle size={14}/>{mapNotice} ×</button>}
      <div className="map-caption"><MapPin size={15}/>{gpsMessage}</div>
    </section>
    </div>
    {mobileMenuOpen && <div className="mobile-menu-backdrop" onClick={() => setMobileMenuOpen(false)}><section className="mobile-menu-sheet road-tools-sheet" role="dialog" aria-modal="true" aria-label="เครื่องมือ Road Alert" onClick={e => e.stopPropagation()}><div className="mobile-menu-head"><div><strong>เครื่องมือ Road Alert</strong><small>เส้นทาง · รถใกล้เคียง · เหตุอันตราย</small></div><button aria-label="ปิดเมนู" onClick={() => setMobileMenuOpen(false)}><X size={21}/></button></div>
            <section className="route-panel">
        <div className="route-heading"><RouteIcon size={20}/><div><h2>ค้นหาสถานที่และเส้นทาง</h2><p>พิมพ์เพียงบางคำ เช่น “สนาม” แล้วเลือกสถานที่จากรายการแนะนำ</p></div></div>
        <form className="route-form" onSubmit={searchRoute}>
          <label>จาก<div className="place-search-field"><input autoComplete="off" value={origin} onFocus={() => setActiveSearchField("origin")} onChange={e => { setActiveSearchField("origin"); setOrigin(e.target.value); setOriginPoint(null); setSuggestionError(""); }} placeholder="เช่น ตำแหน่งของฉัน หรือพิมพ์ว่า สนาม" />{activeSearchField === "origin" && origin.trim().length >= 2 && <div className="place-suggestions" role="listbox">{suggestionsLoading ? <div className="suggestion-status">กำลังค้นหาสถานที่ใกล้เคียง…</div> : originSuggestions.length ? originSuggestions.map((place,index)=><button type="button" key={place.label+index} role="option" onClick={() => {setOrigin(place.label);setOriginPoint({lat:place.lat,lng:place.lng});setOriginSuggestions([]);setActiveSearchField(null);}}><MapPin size={17}/><span><strong>{place.name}</strong><small>{place.label}</small></span></button>) : <div className="suggestion-status">{suggestionError || "ยังไม่พบสถานที่ ลองเพิ่มคำ เช่น สนามกีฬา สนามฟุตบอล หรือระบุอำเภอ"}</div>}</div>}</div></label>
          <label>ไปยัง<div className="place-search-field"><input autoComplete="off" value={destination} onFocus={() => setActiveSearchField("destination")} onChange={e => { setActiveSearchField("destination"); setDestination(e.target.value); setDestinationPoint(null); setSuggestionError(""); }} placeholder="พิมพ์ชื่อบางส่วน เช่น สนาม โรงเรียน ตลาด" />{activeSearchField === "destination" && destination.trim().length >= 2 && <div className="place-suggestions" role="listbox">{suggestionsLoading ? <div className="suggestion-status">กำลังค้นหาสถานที่ใกล้เคียง…</div> : destinationSuggestions.length ? destinationSuggestions.map((place,index)=><button type="button" key={place.label+index} role="option" onClick={() => {setDestination(place.label);setDestinationPoint({lat:place.lat,lng:place.lng});setDestinationSuggestions([]);setActiveSearchField(null);}}><MapPin size={17}/><span><strong>{place.name}</strong><small>{place.label}</small></span></button>) : <div className="suggestion-status">{suggestionError || "ยังไม่พบสถานที่ ลองเพิ่มคำ เช่น สนามกีฬา สนามฟุตบอล หรือระบุอำเภอ"}</div>}</div>}</div></label>
          {waypoints.map((point,index)=><label key={index}>จุดพัก {index+1}<div className="waypoint-input-row"><input value={point} onChange={e=>setWaypoints(old=>old.map((v,i)=>i===index?e.target.value:v))} placeholder="ค้นหาสถานที่พักระหว่างทาง"/><button type="button" aria-label="ลบจุดพัก" onClick={()=>setWaypoints(old=>old.filter((_,i)=>i!==index))}>×</button></div></label>)}
          <button type="button" className="add-waypoint-btn" onClick={()=>setWaypoints(old=>[...old,""])}>＋ เพิ่มจุดพัก (Waypoint)</button>
          <button type="submit" className="route-btn" disabled={routeBusy}><Navigation size={17}/>{routeBusy ? "กำลังค้นหา..." : "ค้นหาเส้นทาง"}</button>
        </form>
        {routeSummary && <p className="route-summary">{routeSummary} <span>· เส้นทางจากข้อมูลแผนที่ ไม่ใช่คำแนะนำจราจรสด</span></p>}
        {routeError && <p className="route-error"><AlertTriangle size={15}/>{routeError}</p>}
        {routeOptions.length > 0 && <div className="route-options"><h3>เลือกเส้นทาง</h3>{routeOptions.map((route,index)=><button type="button" key={index} className={selectedRouteIndex===index?"route-option selected":"route-option"} onClick={()=>chooseRoute(route,index)}><span className="route-option-icon"><Navigation size={18}/></span><span className="route-option-main"><strong>{Math.max(1,Math.round(route.duration/60))} นาที</strong><small>{(route.distance/1000).toFixed(1)} กม. · {index===0?"เส้นทางแนะนำ":"เส้นทางทางเลือก "+(index+1)}</small></span>{selectedRouteIndex===index&&<span className="route-option-check">เลือกแล้ว</span>}</button>)}</div>}
        <div className="map-pick-controls"><span>หรือเลือกจุดจากแผนที่</span><button type="button" className={pickTarget==="origin"?"pick-btn selected":"pick-btn"} onClick={()=>setPickTarget(pickTarget==="origin"?null:"origin")}><MapPin size={15}/>เลือกจุดเริ่มต้น</button><button type="button" className={pickTarget==="destination"?"pick-btn selected":"pick-btn"} onClick={()=>setPickTarget(pickTarget==="destination"?null:"destination")}><MapPin size={15}/>เลือกปลายทาง</button>{pickTarget&&<small>แตะตำแหน่งบนแผนที่เพื่อกำหนด{pickTarget==="origin"?"จุดเริ่มต้น":"ปลายทาง"}</small>}</div>
        {routeSteps.length>0&&<button type="button" className="start-navigation-btn" onClick={()=>{setNavigationMode(true);setDriveMode(true);setMobileMenuOpen(false);if(voiceOn)speakThai("เริ่มนำทาง "+stepText(routeSteps[currentStep]));}}>▶ เริ่มนำทางเต็มหน้าจอ</button>}
        <div className="navigation-controls"><button className={voiceOn?"voice-btn active":"voice-btn"} onClick={()=>{const n=!voiceOn;setVoiceOn(n);if(!n)window.speechSynthesis?.cancel();else if(routeSteps[currentStep])speakThai(stepText(routeSteps[currentStep]));}}><Volume2 size={17}/>{voiceOn?"เสียงภาษาไทยเปิด":"เปิดเสียงนำทาง"}</button>{routeSteps.length>0&&<div className="next-turn"><Navigation size={18}/><div><small>คำสั่งถัดไป</small><strong>{stepText(routeSteps[Math.min(currentStep+1,routeSteps.length-1)])}</strong></div><button onClick={()=>speakThai(stepText(routeSteps[Math.min(currentStep+1,routeSteps.length-1)]))} aria-label="ฟังคำสั่ง"><Volume2 size={16}/></button></div>}</div>
      </section>
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
          {!sharing ? <p className="empty">เปิดแชร์ตำแหน่งเพื่อแสดงรถคันอื่นที่กำลังใช้ Road Alert</p> : nearby.length ? nearby.slice(0,8).map(v => <div className={"vehicle-row " + (v.distance <= 500 ? "vehicle-near" : "")} key={v.id}><span className="vehicle-icon">🚘</span><div className="vehicle-info"><strong>{v.distance <= 500 ? "รถใกล้เคียง · ระวัง" : "รถที่เข้าร่วม"}</strong><small>อัปเดต {Math.max(0,Math.round((Date.now()-v.updatedAt)/1000))} วินาทีที่แล้ว</small></div><strong>{v.distance < 1000 ? Math.round(v.distance)+" ม." : (v.distance/1000).toFixed(1)+" กม."}</strong></div>) : <p className="empty">ยังไม่มีรถคันอื่นรายงานตำแหน่งในขณะนี้</p>}
        </div>
        <div className="panel status-panel"><div className="panel-title"><div><h2>เหตุอันตรายใกล้เคียง</h2><p>รายงานภายใน 30 นาทีที่ผ่านมา</p></div><span className="count">{hazards.length}</span></div>{nearbyHazards.length?nearbyHazards.slice(0,5).map(h=><div className="vehicle-row" key={h.id}><span className="vehicle-icon">{h.type==="accident"?"🚨":h.type==="broken_vehicle"?"🚗":h.type==="obstacle"?"🪨":"⚠️"}</span><div className="vehicle-info"><strong>{hazardLabels[h.type]}</strong><small>{Math.round(h.distance)} เมตร · {Math.max(0,Math.round((Date.now()-h.createdAt)/60000))} นาทีที่แล้ว{h.note?" · "+h.note:""}</small></div></div>):<p className="empty">ยังไม่มีรายงานเหตุใกล้ตำแหน่งของคุณ</p>}</div>
        <div className="safety"><AlertTriangle size={19}/><p><strong>ข้อควรทราบ:</strong> Road Alert แสดงเฉพาะรถที่ผู้ใช้เปิดแชร์ตำแหน่งและเหตุที่มีผู้รายงาน ไม่สามารถตรวจจับรถที่ไม่ได้เข้าร่วม ไม่ใช่เรดาร์หรือระบบแจ้งเตือนอัตโนมัติ และไม่มีข้อมูลจราจรสด ตำแหน่งอาจคลาดเคลื่อนหรือขาดหายได้ โปรดใช้วิจารณญาณและปฏิบัติตามกฎจราจร ไม่ควรแตะหน้าจอขณะขับรถ</p></div>
      </section>
    </section></div>}
    <footer>Road Alert · บริการแผนที่และข้อมูลการเดินทางร่วมกัน · ตำแหน่งจะถูกส่งเมื่อคุณเปิดแชร์เท่านั้น</footer>
  </main>;
}
