import type {Frame} from './flight.ts';

/**
 * Treat a pause as a missing-data gap relative to the browser's recent receipt
 * cadence. The bounds support both the 5–10 Hz simulator and the slower
 * 500–1000 ms ESP8266 HTTPS uplink without joining genuinely stale samples.
 */
export function telemetryGapThreshold(frames:Pick<Frame,'receivedAt'>[]):number{
 const deltas:number[]=[];const recent=frames.slice(-121);
 for(let i=1;i<recent.length;i++){const delta=recent[i].receivedAt-recent[i-1].receivedAt;if(Number.isFinite(delta)&&delta>0)deltas.push(delta)}
 if(!deltas.length)return 2000;
 deltas.sort((a,b)=>a-b);const middle=Math.floor(deltas.length/2),median=deltas.length%2?deltas[middle]:(deltas[middle-1]+deltas[middle])/2;
 return Math.max(600,Math.min(2000,median*2.5));
}
