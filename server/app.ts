import './env.js';
import express from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pdfParse from 'pdf-parse';

const app = express();
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const manualDir = path.join(root, 'data', 'manuals');
fs.mkdirSync(manualDir, { recursive: true });
app.use(express.json({ limit: '25mb' }));
app.use('/api', (req, res, next) => {
 res.on('finish', () => console.log(`[API] ${req.method} ${req.path} ${res.statusCode}`));
 next();
});
const docs: Array<{ id: string; name: string; pages: number; chunks: Array<{ page: number; text: string }> }> = [];
const IncidentSchema = z.object({ id: z.string(), parameter: z.string(), previous: z.number(), current: z.number(), safeRange: z.string(), severity: z.string(), detectedAt: z.string() });
const InvestigationSchema = z.object({ anomaly: IncidentSchema, telemetryWindow: z.array(z.record(z.string(), z.any())).max(120), recentEvents: z.array(z.record(z.string(), z.any())).max(30), historicalIncidents: z.array(z.record(z.string(), z.any())).max(10), retrievedDocuments: z.array(z.record(z.string(), z.any())).max(6) });
const incidents = [
 { id: 'INC-001', title: 'Thermal control excursion', subsystem: 'Thermal', timestamp: '2026-03-14T04:22:00Z', symptoms: ['Temperature rose above 55°C', 'CPU load remained nominal'], pattern: { temperature: 'elevated', cpu: 'nominal' }, possibleCause: 'Simulated radiator-control lag', resolution: 'Operator verified sensor and simulated radiator reset', evidence: 'Demo archive record INC-001' },
 { id: 'INC-002', title: 'Battery undervoltage', subsystem: 'Electrical Power', timestamp: '2026-04-02T19:08:00Z', symptoms: ['Battery below 24 V', 'Solar current under 2 A'], pattern: { battery: 'low', solar: 'low' }, possibleCause: 'Simulated reduced generation with sustained load', resolution: 'Operator confirmed array input and shed simulated nonessential load', evidence: 'Demo archive record INC-002' },
 { id: 'INC-003', title: 'Communication degradation', subsystem: 'Communications', timestamp: '2026-04-29T11:51:00Z', symptoms: ['Packet loss above 10%', 'Battery voltage declining'], pattern: { packetLoss: 'high', battery: 'low' }, possibleCause: 'Simulated bus margin reduction', resolution: 'Operator checked link budget and restored simulated power margin', evidence: 'Demo archive record INC-003' },
 { id: 'INC-004', title: 'Power subsystem instability', subsystem: 'Electrical Power', timestamp: '2026-05-18T06:13:00Z', symptoms: ['Solar current below 2 A', 'Battery warning follows'], pattern: { solar: 'low', battery: 'declining' }, possibleCause: 'Simulated generation shortfall', resolution: 'Operator reviewed array telemetry and confirmed recovery', evidence: 'Demo archive record INC-004' }
];
app.get('/api/health', (_req, res) => res.json({ ok: true, aiConfigured: Boolean(process.env.GEMINI_API_KEY), mode: process.env.GEMINI_API_KEY ? 'gemini' : 'demo', model: 'gemini-3.8-flash' }));
app.get('/api/incidents', (_req, res) => res.json(incidents));
app.post('/api/manual', async (req, res) => {
 try {
  const { name, data } = z.object({ name: z.string().max(180), data: z.string().regex(/^[A-Za-z0-9+/=]+$/).max(20_000_000) }).parse(req.body);
  const bytes = Buffer.from(data, 'base64');
  if (bytes.subarray(0, 5).toString() !== '%PDF-') return res.status(400).json({ error: 'The uploaded file does not have a valid PDF header.' });
  const parsed = await pdfParse(bytes);
  const pagesText = parsed.text.split('\f').map(s => s.trim()).filter(Boolean);
  const chunks = pagesText.flatMap((text, i) => text.match(/.{1,900}(?:\s|$)/gs)?.map(part => ({ page: i + 1, text: part.trim() })) || []);
  const doc = { id: `DOC-${Date.now()}`, name: path.basename(name).slice(0, 180), pages: parsed.numpages, chunks };
  docs.unshift(doc);
  fs.writeFileSync(path.join(manualDir, `${doc.id}.json`), JSON.stringify(doc));
  res.json({ id: doc.id, name: doc.name, pages: doc.pages, chunks: chunks.length, bytes: bytes.length, status: chunks.length ? 'INDEXED' : 'NO TEXT FOUND' });
 } catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : 'Manual could not be indexed.' }); }
});
function terms(s: string) { return s.toLowerCase().replace(/[^a-z0-9. ]/g, ' ').split(/\s+/).filter(w => w.length > 2); }
app.post('/api/investigate', async (req, res) => {
 try {
  const data = InvestigationSchema.parse(req.body);
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.json({ mode: 'demo', result: fallback(data.anomaly, data.telemetryWindow, data.historicalIncidents, data.retrievedDocuments) });
  const prompt = `You are a spacecraft mission operations copilot assisting a human operator in a simulation. You do not control any spacecraft. Separate observed facts from possible causes and recommendations. Do not invent telemetry, incidents, documents, procedures, page numbers, or evidence. Cite only provided evidence IDs. State when evidence is insufficient or mission documentation was not found. Every recommendation must cite evidence IDs. The operator is the final decision-maker. Return only JSON with keys observedFacts (array of {text,evidenceIds}), possibleCauses (array of {text,evidenceIds}), recommendedActions (array of {text,evidenceIds}), evidence (array of {id,label,detail}), historicalMatches (array of {id,title,basis}), sources (array of {id,label}), operatorNote (string).
Investigation context (all simulator/demo data):\n${JSON.stringify(data)}`;
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000), body: JSON.stringify({ systemInstruction: { parts: [{ text: 'You are an evidence-grounded mission operations copilot. Obey the user-facing investigation contract.' }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.15, maxOutputTokens: 4096 } }) });
  if (!response.ok) throw new Error(`Gemini request failed (${response.status}).`);
  const raw: any = await response.json();
  const text = raw.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('');
  const result = validateModel(JSON.parse(text));
  res.json({ mode: 'gemini', result });
 } catch (e) {
  if (e instanceof z.ZodError) return res.status(400).json({ error: 'Invalid investigation context.' });
  const reason = e instanceof Error ? e.message : 'Unknown provider error';
  console.error('Investigation fell back to demo:', reason);
  try { const data = InvestigationSchema.parse(req.body); res.json({ mode: 'demo-fallback', warning: 'AI OFFLINE / DEMO FALLBACK', providerError: reason, result: fallback(data.anomaly, data.telemetryWindow, data.historicalIncidents, data.retrievedDocuments) }); }
  catch { res.status(500).json({ error: 'Investigation could not be prepared.' }); }
 }
});
function validateModel(x: any) {
 const strList = (v: any) => Array.isArray(v) ? v.filter((i: any) => i && typeof i.text === 'string').map((i: any) => ({ text: i.text.slice(0, 1200), evidenceIds: Array.isArray(i.evidenceIds) ? i.evidenceIds.filter((id: any) => typeof id === 'string').slice(0, 8) : [] })) : [];
 return { observedFacts: strList(x.observedFacts), possibleCauses: strList(x.possibleCauses), recommendedActions: strList(x.recommendedActions), evidence: Array.isArray(x.evidence) ? x.evidence.filter((i: any) => i && typeof i.id === 'string' && typeof i.label === 'string').slice(0, 12) : [], historicalMatches: Array.isArray(x.historicalMatches) ? x.historicalMatches.filter((i: any) => i && typeof i.id === 'string' && typeof i.title === 'string').slice(0, 8) : [], sources: Array.isArray(x.sources) ? x.sources.filter((i: any) => i && typeof i.id === 'string' && typeof i.label === 'string').slice(0, 12) : [], operatorNote: typeof x.operatorNote === 'string' ? x.operatorNote.slice(0, 1000) : 'Evidence is limited; operator review required.' };
}
function fallback(a: z.infer<typeof IncidentSchema>, telemetry: any[], matches: any[], retrieved: any[]) {
 const point = telemetry.at(-1) || {};
 const evidence = [{ id: 'TEL-WINDOW', label: 'SIMULATED LIVE TELEMETRY', detail: `${telemetry.length} recent samples; current ${a.parameter} ${a.current} at ${a.detectedAt}.` }, ...matches.slice(0, 2).map((i: any) => ({ id: i.id, label: `${i.id} · ${i.title}`, detail: `${(i.symptoms || []).join('; ')}. Demo archive: ${i.evidence || 'simulated incident record'}.` })), ...retrieved.slice(0, 4).map((d: any, i: number) => ({ id: `DOC-${i + 1}`, label: `${d.name} · page ${d.page}`, detail: String(d.text).slice(0, 500) }))];
 const causes: Record<string, string> = { temperature: 'The elevated reading is consistent with a thermal-control excursion in this simulation. Telemetry alone does not identify a failed component.', battery: 'The low voltage may reflect reduced simulated power margin. Check whether solar generation is also reduced before attributing a cause.', solar: 'The low solar-current reading indicates reduced simulated generation; the available evidence does not identify why generation fell.', packetLoss: 'The packet-loss reading indicates degraded simulated communications. Correlated power or CPU values may be relevant, but do not prove causation.', cpu: 'The CPU reading indicates elevated onboard processing load in the simulation. The current evidence does not identify the workload source.' };
 const actions: Record<string, string[]> = { temperature: ['Verify the simulated temperature reading against adjacent telemetry samples.', 'Inspect thermal subsystem indicators and compare the trend with the retrieved evidence.', 'Keep recovery under operator control; use the simulated recovery only after approval.'], battery: ['Review solar current and recent battery trend for correlation.', 'Check the electrical-power indicators against the mission manual excerpts if available.', 'Approve simulated power recovery only after operator review.'], solar: ['Compare solar current with the battery trend and recent samples.', 'Review the uploaded manual excerpt if it contains a relevant generation procedure.', 'Use the simulated recovery after operator approval.'], packetLoss: ['Review packet loss alongside battery voltage and CPU load.', 'Check communication subsystem indicators and any retrieved documented steps.', 'Approve simulated link recovery only after operator review.'], cpu: ['Review CPU load trend and packet-loss correlation.', 'Inspect the simulated processing indicators before taking action.', 'Use the simulated load-shed recovery only after operator approval.'] };
 return { observedFacts: [{ text: `${a.parameter} changed from ${a.previous} to ${a.current}; the local rule engine classified this episode as ${a.severity.toLowerCase()} at ${a.detectedAt}. Configured safe range: ${a.safeRange}.`, evidenceIds: ['TEL-WINDOW'] }, ...(point.solar != null && point.battery != null ? [{ text: `Latest correlated simulated readings: solar ${point.solar} A, battery ${point.battery} V, packet loss ${point.packetLoss}%.`, evidenceIds: ['TEL-WINDOW'] }] : [])], possibleCauses: [{ text: causes[a.parameter] || 'Available telemetry does not support a specific cause. Further operator inspection is required.', evidenceIds: ['TEL-WINDOW', ...(matches[0] ? [matches[0].id] : [])] }], recommendedActions: (actions[a.parameter] || ['Review the recent telemetry and subsystem indicators.', 'Request more evidence before recovery.']).map(text => ({ text, evidenceIds: ['TEL-WINDOW', ...(retrieved.length ? ['DOC-1'] : [])] })), evidence, historicalMatches: matches.slice(0, 2).map((i: any) => ({ id: i.id, title: i.title, basis: `Matching pattern found in historical incident data: ${(i.symptoms || []).join('; ')}.` })), sources: [{ id: 'TEL-WINDOW', label: 'Simulated telemetry context' }, ...matches.slice(0, 2).map((i: any) => ({ id: i.id, label: `Historical demo incident ${i.id}` })), ...retrieved.slice(0, 4).map((d: any, i: number) => ({ id: `DOC-${i + 1}`, label: `${d.name}, page ${d.page}` }))], operatorNote: retrieved.length ? 'DEMO FALLBACK: rule-based investigation. Uploaded document excerpts are retrieved locally; validate all procedures with the operator.' : 'DEMO FALLBACK: rule-based investigation. Not found in uploaded mission documentation. Validate all actions with the operator.' };
}
const diskDocs = () => { try { for (const f of fs.readdirSync(manualDir).filter(x => x.endsWith('.json'))) { const d = JSON.parse(fs.readFileSync(path.join(manualDir, f), 'utf8')); if (!docs.some(x => x.id === d.id)) docs.push(d); } } catch { } };
app.post('/api/retrieve', (req, res) => {
 diskDocs(); const { query } = z.object({ query: z.string().max(300) }).parse(req.body); const q = new Set(terms(query));
 const found = docs.flatMap(d => d.chunks.map(c => ({ name: d.name, page: c.page, text: c.text, score: terms(c.text).filter(w => q.has(w)).length }))).filter(c => c.score > 0).sort((a, b) => b.score - a.score).slice(0, 4).map(({ score, ...x }) => x);
 res.json({ documents: found, totalIndexed: docs.length });
});
const ChatSchema = z.object({
 question: z.string().trim().min(1).max(1200),
 history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(2000) })).max(12).default([]),
 telemetry: z.record(z.string(), z.number()).default({}),
 statuses: z.record(z.string(), z.string()).default({}),
 telemetryWindow: z.array(z.record(z.string(), z.any())).max(30).default([]),
 recentEvents: z.array(z.record(z.string(), z.any())).max(12).default([]),
 historicalIncidents: z.array(z.record(z.string(), z.any())).max(8).default([]),
 retrievedDocuments: z.array(z.object({ name: z.string(), page: z.number(), text: z.string().max(2000) })).max(4).default([]),
});
function localAnswer(q: string, data: z.infer<typeof ChatSchema>) {
 const question = q.toLowerCase();
 const readings = data.telemetry;
 const abnormal = Object.entries(data.statuses).filter(([, state]) => state !== 'NOMINAL');
 const facts = Object.entries(readings).map(([key, value]) => `${key}: ${value}`).join(' · ');
 const manual = data.retrievedDocuments[0];
 if (manual && /(manual|document|procedure|flight|section|page|uploaded|pdf|what does)/i.test(question)) {
  return `I found a relevant passage in ${manual.name}, page ${manual.page}: “${manual.text.slice(0, 420)}”\n\nThis is a retrieved excerpt; check the source document for the full procedure.`;
 }
 if (abnormal.length && /(why|cause|abnormal|anomal|behav|happen|system|status)/i.test(question)) {
  const detail = abnormal.map(([key, state]) => `${key} is ${state.toLowerCase()} at ${readings[key] ?? 'an unknown value'}`).join('; ');
  const newest = data.telemetryWindow.at(-1) || {};
  const prior = data.telemetryWindow.at(-Math.min(6, data.telemetryWindow.length)) || {};
  const deltas = Object.keys(newest).filter(k => typeof newest[k] === 'number' && typeof prior[k] === 'number').map(k => `${k} ${Number(prior[k]).toFixed(1)}→${Number(newest[k]).toFixed(1)}`).join(', ');
  return `The local rule engine currently flags ${detail}. Recent simulated trend: ${deltas || 'not enough samples yet'}. This describes the simulator state, not a confirmed hardware fault. ${data.retrievedDocuments.length ? `The retrieved manual excerpt is from ${manual?.name}, page ${manual?.page}.` : 'Not found in uploaded mission documentation.'}`;
 }
 const concepts: Array<[RegExp, string]> = [
  [/solar|array|generation|charging/i, `Solar current is ${readings.solar ?? 'not available'} A. In this simulation, sustained low solar current can gradually reduce battery voltage; communications may degrade after battery margin falls. The dependency is deterministic and does not establish a real spacecraft cause.`],
  [/battery|voltage|power/i, `Battery is ${readings.battery ?? 'not available'} V and solar current is ${readings.solar ?? 'not available'} A. The simulator models reduced generation as a gradual battery decline. Current flags: ${abnormal.map(([k,s])=>`${k} ${s}`).join(', ') || 'none'}.`],
  [/packet|communication|link|loss/i, `Packet loss is ${readings.packetLoss ?? 'not available'}%. The simulation can increase link loss when battery margin falls or CPU load is high. This is a model relationship, not proof of causation.`],
  [/temperature|thermal|heat/i, `Temperature is ${readings.temperature ?? 'not available'} °C. The local rules classify above 40 °C as a warning and above 55 °C as critical. Elevated simulated temperature can also increase CPU load in this model.`],
  [/cpu|processor|load/i, `CPU load is ${readings.cpu ?? 'not available'}%. The local rules mark above 60% as a warning and above 85% as critical. High load can slightly increase simulated packet loss.`],
  [/telemetry|readings|values|nominal/i, `Current simulated readings: ${facts || 'not available'}. Active local flags: ${abnormal.map(([k,s])=>`${k} ${s}`).join(', ') || 'none; all monitored values are currently nominal'}.`],
 ];
 const concept = concepts.find(([pattern]) => pattern.test(question));
 if (concept) return `${concept[1]}${manual ? ` Relevant manual excerpt: ${manual.name}, page ${manual.page}.` : ' Not found in uploaded mission documentation.'}`;
 return `I can answer from the current simulated telemetry, historical incident records, and uploaded manual excerpts. Your question was: “${q}”. Current readings: ${facts || 'not available'}. ${manual ? `A matching excerpt was retrieved from ${manual.name}, page ${manual.page}.` : 'Not found in uploaded mission documentation.'} This is a local fallback because Gemini is unavailable; configure a working Gemini API key and network connection for open-ended answers.`;
}
app.post('/api/chat', async (req, res) => {
 let data: z.infer<typeof ChatSchema>;
 try { data = ChatSchema.parse(req.body); }
 catch { return res.status(400).json({ error: 'Question or chat context is invalid.' }); }
 const evidence = data.retrievedDocuments.map((d, i) => ({ id: `DOC-${i + 1}`, label: `${d.name}, page ${d.page}`, excerpt: d.text }));
 const system = `You are Aegis, a mission-operations support copilot for the AURORA-1 SIMULATION. Stay strictly on this mission's simulated systems: telemetry, subsystem behavior, anomaly causes, uploaded mission/flight manuals, and diagnostic suggestions. Politely redirect unrelated questions back to the mission. Answer the user's actual question directly and specifically; use the current readings, rule statuses, recent event log, conversation, and retrieved manual passages. Do not repeat canned answers. Clearly distinguish observed simulator facts, possible explanations, and suggested checks. Use general engineering reasoning only for clearly labeled suggestions; never present it as a procedure from the manual. Cite manual sources by exact supplied document name and page. If no retrieved passage supports the manual question, say “Not found in uploaded mission documentation.” Never invent procedures, readings, incidents, sections, or page numbers. Do not issue commands to a real spacecraft. Return valid JSON only: {"answer":"string","sources":["exact source labels from supplied evidence, if used"]}.`;
 const context = JSON.stringify({ currentSimulatedTelemetry: data.telemetry, localRuleStatuses: data.statuses, recentTelemetrySamples: data.telemetryWindow, recentMissionEvents: data.recentEvents, historicalDemoIncidents: data.historicalIncidents, retrievedManualExcerpts: evidence });
 const key = process.env.GEMINI_API_KEY;
 if (!key) return res.json({ mode: 'demo-fallback', providerError: 'GEMINI_API_KEY is missing from the local backend environment.', answer: localAnswer(data.question, data), sources: evidence.map(e => e.label) });
 try {
  const contents = [...data.history.slice(-8).map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] })), { role: 'user', parts: [{ text: `Current mission context (simulated): ${context}\n\nQuestion: ${data.question}` }] }];
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000), body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { responseMimeType: 'application/json', temperature: 0.55, maxOutputTokens: 1200 } }) });
  const body: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Gemini API ${response.status}: ${body.error?.message || 'request failed'}`);
  const raw = body.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('');
  const answer = JSON.parse(raw);
  if (typeof answer.answer !== 'string' || !answer.answer.trim()) throw new Error('Gemini returned an empty answer.');
  const allowed = new Set(evidence.map(e => e.label));
  res.json({ mode: 'gemini', answer: answer.answer.slice(0, 5000), sources: Array.isArray(answer.sources) ? answer.sources.filter((s: any) => typeof s === 'string' && allowed.has(s)).slice(0, 4) : [] });
 } catch (e) {
  const reason = e instanceof Error ? e.message : 'Unknown provider error';
  console.error('General copilot request fell back:', reason);
  res.json({ mode: 'demo-fallback', providerError: reason, answer: localAnswer(data.question, data), sources: evidence.map(e => e.label) });
 }
});
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
 if (res.headersSent) return next(err);
 const detail = String(err?.message || 'Unexpected local API error').replace(/[\r\n\t]/g, ' ').slice(0, 300);
 console.error(`[API ERROR] ${req.method} ${req.path}: ${detail}`);
 res.status(500).json({ error: 'Local mission API error', detail });
});
export default app;
