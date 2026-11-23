// Shared transit logic: this file is used by the server, browser, and tests.
export const ROUTE_LINES = {'1':'yellow','2':'yellow','3':'orange','4':'orange','5':'green','6':'green','7':'red','8':'red','11':'blue','12':'blue'};
export const TRIP_MAX_AGE = 90;
export const ALERT_MAX_AGE = 600;

export function lineForRoute(id, schedule) {
  if (ROUTE_LINES[id]) return ROUTE_LINES[id];
  const route = schedule.routes?.[id];
  if (!route) return null;
  const name = (route.route_short_name || '').toLowerCase();
  const named = ['yellow','red','orange','green','blue'].find(line=>name.startsWith(line));
  if (named) return named;
  return {'FFFF33':'yellow','FF0000':'red','FF9933':'orange','339933':'green','0099CC':'blue'}[(route.route_color || '').replace('#','').toUpperCase()] || null;
}

export function sourceState(timestamp, now, maxAge = TRIP_MAX_AGE) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'unavailable';
  const age = now / 1000 - timestamp;
  if (age < -30) return 'unavailable';
  return age > maxAge ? 'stale' : 'live';
}

export function serviceActive(schedule, serviceId, date) {
  if (!/^\d{8}$/.test(date || '')) return false;
  const exception = schedule.exceptions.find(e => e.service_id === serviceId && e.date === date);
  if (exception) return exception.exception_type === '1';
  const c = schedule.calendar.find(c => c.service_id === serviceId);
  if (!c || date < c.start_date || date > c.end_date) return false;
  const day = new Date(`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}T12:00:00Z`).getUTCDay();
  return c[['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][day]] === '1';
}

export function pacificDate(timestamp) {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone:'America/Los_Angeles', year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(new Date(timestamp));
  const value = name => parts.find(p => p.type === name).value;
  return value('year') + value('month') + value('day');
}

// Only draw a train when the time interval resolves to two neighboring stations.
// The times are predictions, so this is estimated progress, never a GPS fix.
export function inferSegment(train, now) {
  if (sourceState(train.timestamp, now) !== 'live' || train.cancelled) return null;
  const seconds = now / 1000;
  const stops = train.stops;
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    if (stop.arrival != null && stop.departure != null && seconds >= stop.arrival && seconds <= stop.departure) {
      return {from:stop.station, to:stop.station, start:stop.arrival, end:stop.departure, progress:0, method:'Predicted station dwell', platform:stop.platform};
    }
    if (!i || stop.arrival == null || seconds > stop.arrival) continue;
    const previous = stops[i - 1];
    if (previous.skipped || stop.skipped) continue;
    let start = previous.departure;
    let method = 'Interpolated between stop predictions';
    if (start == null && previous.scheduledDeparture != null && stop.scheduledArrival != null) {
      const duration = stop.scheduledArrival - previous.scheduledDeparture;
      if (duration > 0 && duration <= 1200) {
        start = stop.arrival - duration;
        method = 'Estimated from next arrival and scheduled running time';
      }
    }
    if (start == null || seconds < start || stop.arrival <= start || stop.arrival - start > 1800) continue;
    return {from:previous.station, to:stop.station, start, end:stop.arrival, progress:Math.max(0,Math.min(1,(seconds-start)/(stop.arrival-start))), method, platform:stop.platform};
  }
  return null;
}

function number(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function reportedNumber(event, field) {
  return event && Object.hasOwn(event,field) ? number(event[field]) : null;
}

// Remaining scheduled stops stay visible, but only actual predictions get ETAs.
export function upcomingStops(train, now) {
  if (!train || train.cancelled || sourceState(train.timestamp,now)!=='live') return [];
  const seconds=now/1000;
  const start=train.stops.findIndex(stop=>!stop.skipped && (stop.departure??stop.arrival)>=seconds);
  if(start<0)return [];
  return train.stops.slice(start).filter(stop=>!stop.skipped && (stop.departure==null&&stop.arrival==null || (stop.departure??stop.arrival)>=seconds)).map(stop=>{
    const atStation=stop.arrival!=null&&stop.departure!=null&&stop.arrival<=seconds&&stop.departure>=seconds;
    const event=atStation||stop.arrival==null?'departure':'arrival';
    const fallback=event==='arrival'?'departure':'arrival';
    return {...stop,atStation,time:atStation?seconds:(stop[event]??stop[fallback]),delaySeconds:stop[event+'Delay']??stop[fallback+'Delay']??null,uncertaintySeconds:stop[event+'Uncertainty']??stop[fallback+'Uncertainty']??null};
  });
}

export function trainDelay(train,now) {
  const next=upcomingStops(train,now)[0];
  return next && Number.isFinite(next.delaySeconds) ? {station:next.station,seconds:next.delaySeconds,uncertainty:next.uncertaintySeconds} : null;
}

// A gap is between two fresh predictions on the same line and direction.
// Compare with that pair's schedule so a normal 20-minute service isn't an alarm.
export function serviceGaps(departures,now) {
  const groups=new Map(),seconds=now/1000;
  for(const departure of departures||[]){
    if(!Number.isFinite(departure.time)||departure.time<seconds-15||departure.time>seconds+5400||sourceState(departure.timestamp,now)!=='live')continue;
    const direction=departure.directionId??`${departure.routeId||''}:${departure.terminal||departure.headsign}`;
    const key=`${departure.line}:${departure.routeId||''}:${direction}`;
    if(!groups.has(key))groups.set(key,new Map());
    const group=groups.get(key),previous=group.get(departure.id);
    if(!previous||departure.time<previous.time)group.set(departure.id,departure);
  }
  const gaps=[];
  for(const [key,group]of groups){
    const [first,second]=[...group.values()].sort((a,b)=>a.time-b.time);
    if(!first||!second||first.time>seconds+1800)continue;
    const gap=second.time-first.time;
    const scheduled=first.serviceDate&&first.serviceDate===second.serviceDate&&Number.isFinite(first.scheduledTime)&&Number.isFinite(second.scheduledTime)?second.scheduledTime-first.scheduledTime:null;
    const baseline=scheduled>0&&scheduled<=3600?scheduled:null;
    if(baseline!=null ? gap<600||gap-baseline<300||gap<baseline*1.5 : gap<1200)continue;
    gaps.push({key,line:first.line,headsign:first.headsign===second.headsign?first.headsign:`${first.headsign} / ${second.headsign}`,seconds:gap,scheduledSeconds:baseline,next:first,following:second});
  }
  return gaps.sort((a,b)=>(b.seconds-(b.scheduledSeconds||0))-(a.seconds-(a.scheduledSeconds||0)));
}

export function normalizeTrips(feed, schedule, now) {
  const timestamp = number(feed.header?.timestamp);
  const trains = [], departures = {}, cancelled = [];
  let unmatched = 0, inactive = 0;
  const date = pacificDate(now);
  const yesterday = pacificDate(now - 86400000);
  for (const entity of feed.entity || []) {
    const u = entity.tripUpdate;
    if (!u || entity.isDeleted) continue;
    const raw = u.trip || {}, tripId = String(raw.tripId || '');
    const trip = schedule.trips[tripId];
    if (!trip || !lineForRoute(trip.route,schedule)) { unmatched++; continue; }
    const serviceDate = raw.startDate || (serviceActive(schedule, trip.service, date) ? date : yesterday);
    if (!serviceActive(schedule, trip.service, serviceDate)) { inactive++; continue; }
    const key = `${serviceDate}:${tripId}:${raw.startTime || ''}`;
    if (Number(raw.scheduleRelationship) === 3 || Number(raw.scheduleRelationship) === 7) {cancelled.push(key);continue;}
    const observations = new Map((u.stopTimeUpdate || []).map(s => [s.stopId || `seq:${s.stopSequence}`, s]));
    const byStation = new Map((u.stopTimeUpdate || []).filter(s=>s.stopId).map(s=>[schedule.parents[s.stopId]||s.stopId,s]));
    const trainTimestamp = number(u.timestamp) || timestamp;
    const stops = trip.stops.map(s => {
      const update = observations.get(s[4]) || observations.get(`seq:${s[3]}`) || byStation.get(s[0]);
      const arrival = update?.arrival?.time != null ? number(update.arrival.time) : null;
      const departure = update?.departure?.time != null ? number(update.departure.time) : null;
      const skipped = Number(update?.scheduleRelationship) === 1;
      const noData = Number(update?.scheduleRelationship) === 2;
      const platformId=update?.stopId||s[4];
      const platform=schedule.platformCodes?.[platformId]||(/^[A-Z]\d+-([12])$/.exec(platformId)?.[1])||null;
      return {station:s[0], platform, platformSource:update?.stopId?'reported':'scheduled', sequence:s[3], scheduledArrival:s[1], scheduledDeparture:s[2], arrival:noData?null:arrival ?? departure, departure:noData?null:departure ?? arrival, arrivalDelay:noData?null:reportedNumber(update?.arrival,'delay'), departureDelay:noData?null:reportedNumber(update?.departure,'delay'), arrivalUncertainty:noData?null:reportedNumber(update?.arrival,'uncertainty'), departureUncertainty:noData?null:reportedNumber(update?.departure,'uncertainty'), skipped};
    });
    const line = lineForRoute(trip.route,schedule);
    const terminal = trip.stops.at(-1)?.[0];
    const headsign = schedule.stationNames[terminal] || trip.headsign;
    const directionId=number(raw.directionId??trip.directionId);
    const train = {id:key, tripId, line, routeId:trip.route, directionId, serviceDate, headsign, terminal, timestamp:trainTimestamp, stops};
    trains.push(train);
    if (sourceState(trainTimestamp, now) !== 'live') continue;
    stops.forEach((s, i) => {
      const time = s.departure ?? s.arrival;
      if (s.skipped || i === stops.length - 1 || time == null || time < now / 1000 - 15 || time > now / 1000 + 5400) return;
      (departures[s.station] ||= []).push({id:key, line, routeId:trip.route, directionId, serviceDate, terminal, headsign, platform:s.platform, platformSource:s.platformSource, time, scheduledTime:s.scheduledDeparture, timestamp:trainTimestamp, delay:s.departureDelay??s.arrivalDelay});
    });
  }
  for (const items of Object.values(departures)) items.sort((a,b) => a.time-b.time);
  return {timestamp, trains, departures, cancelled, counts:{tripUpdates:(feed.entity || []).filter(e=>e.tripUpdate).length, matchedTrips:trains.length, unmatchedTrips:unmatched, inactiveTrips:inactive, positionedTrips:trains.filter(t=>inferSegment(t,now)).length}};
}

function translated(value) {
  const translations = value?.translation || [];
  return (translations.find(t => !t.language || t.language.startsWith('en')) || translations[0])?.text || '';
}

export function normalizeAlerts(feed, schedule, now) {
  const alerts = [];
  for (const e of feed.entity || []) {
    const a = e.alert;
    if (!a || e.isDeleted) continue;
    const periods = a.activePeriod || [];
    if (periods.length && !periods.some(p => (!p.start || Number(p.start) <= now / 1000) && (!p.end || Number(p.end) >= now / 1000))) continue;
    const stations = [], lines = [];
    for (const scope of a.informedEntity || []) {
      const station = schedule.parents[scope.stopId] || scope.stopId;
      if (station && schedule.stationNames[station]) stations.push(station);
      const routeId = scope.routeId || schedule.trips[scope.trip?.tripId]?.route;
      const line = lineForRoute(routeId,schedule);
      if (line) lines.push(line);
    }
    alerts.push({id:e.id, header:translated(a.headerText), description:translated(a.descriptionText), stations:[...new Set(stations)], lines:[...new Set(lines)], effect:Number(a.effect) || null});
  }
  return {timestamp:number(feed.header?.timestamp), items:alerts};
}
