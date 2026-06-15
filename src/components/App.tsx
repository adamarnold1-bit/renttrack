import { useState, useEffect } from "preact/hooks";
import { AiChatWidget } from "./AiChat";

const BASE = "/api/rent-tracker";
const API = (entity: string, extra = "") => `${BASE}?entity=${entity}${extra}`;

const fmt = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COLORS = ["#00c9a7","#f59e0b","#818cf8","#f43f5e","#34d399","#60a5fa","#fb923c","#e879f9"];

type Property = { id: string; name: string; address: string; units: number };
type Renter = { id: string; name: string; email: string; phone?: string; propertyId: string; unit: string; rentAmount: number; rentFrequency: "monthly"|"weekly"; dueDay: number; pin?: string; photo?: string };
type Message = { id: string; renterId: string; renterName: string; propertyId: string; text: string; createdAt: string; isAdmin?: boolean };
const WEEKDAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
type Payment = { id: string; renterId: string; amount: number; date: string; paidThrough: string; status: "paid"|"pending"|"late"; note: string };

function paidThroughDefault(renter: Renter | undefined, payDate: string): string {
  if (!renter || !payDate) return "";
  const d = new Date(payDate + "T00:00:00");
  if (renter.rentFrequency === "weekly") {
    // Advance to the following Saturday (end of Sun–Sat week)
    const dow = d.getDay(); // 0=Sun, 6=Sat
    d.setDate(d.getDate() + (6 - dow));
  } else {
    // end of the month of payDate
    d.setMonth(d.getMonth() + 1, 0);
  }
  return d.toISOString().slice(0, 10);
}
type Allocation = { id: string; label: string; pct: number; color: string };
type Bill = { id: string; name: string; propertyId: string; amount: number; dueDate: string; frequency: string; status: "paid"|"pending"|"overdue"; notes: string; confirmationNumber?: string };
type PayMethod = { id: string; method: string; handle: string; enabled: boolean };

const PAY_METHODS: { key: string; label: string; icon: string; linkTemplate?: (h: string) => string; instructions: (h: string) => string }[] = [
  { key: "cashapp",  label: "Cash App",  icon: "💚", linkTemplate: h => `https://cash.app/${h}`,    instructions: h => `Open Cash App → tap $ → search ${h}` },
  { key: "paypal",   label: "PayPal",    icon: "🔵", linkTemplate: h => `https://paypal.me/${h}`,   instructions: h => `Go to paypal.me/${h} or open PayPal → Send → ${h}` },
  { key: "zelle",    label: "Zelle",     icon: "🟣", instructions: h => `Open your bank app → Zelle → Send money to ${h}` },
  { key: "applepay", label: "Apple Pay", icon: "🍎", instructions: h => `Open Messages → new message to ${h} → tap the $ icon → enter amount → send` },
  { key: "chime",    label: "Chime",     icon: "🟡", instructions: h => `Open Chime → Pay Anyone tab → search ${h} → enter amount` },
  { key: "sofi",     label: "SoFi",      icon: "🟢", instructions: h => `Open SoFi → Money tab → Send Money → search or enter ${h}` },
];

function toast(msg: string, type: "success"|"error"|"info" = "success") {
  const el = document.createElement("div");
  el.textContent = msg;
  el.style.cssText = `position:fixed;bottom:24px;right:24px;padding:12px 20px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999;transition:opacity 0.3s;background:${type==="success"?"#00c9a7":type==="error"?"#f43f5e":"#818cf8"};color:#0f1a2e;box-shadow:0 4px 20px rgba(0,0,0,0.4)`;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 300); }, 3000);
}

async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, opts);
  return r;
}

function useData<T>(entity: string) {
  const [data, setData] = useState<T[]>([]);
  const reload = () => apiFetch(API(entity)).then(r => r.json()).then(setData).catch(() => {});
  useEffect(() => { reload(); }, []);
  return [data, setData, reload] as const;
}

async function post<T>(entity: string, body: object): Promise<T> {
  const r = await apiFetch(API(entity), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}
async function del(entity: string, id: string) {
  await apiFetch(`${API(entity)}&id=${id}`, { method: "DELETE" });
}

function confirm(msg: string): Promise<boolean> {
  return Promise.resolve(window.confirm(msg));
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: any }) {
  return (
    <div class="rt-overlay" onClick={e => { if ((e.target as HTMLElement).classList.contains("rt-overlay")) onClose(); }}>
      <div class="rt-modal">
        <div class="rt-modal-header">
          <div class="rt-modal-title">{title}</div>
          <button class="rt-btn rt-btn-ghost rt-btn-sm" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function PropertiesTab({ properties, reload }: { properties: Property[]; reload: () => void }) {
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name: "", address: "", units: "1" });
  const save = async () => {
    if (!form.name || !form.address) { toast("Name and address required", "error"); return; }
    await post("properties", { ...form, units: parseInt(form.units) || 1 });
    toast("Property added"); setModal(false); setForm({ name: "", address: "", units: "1" }); reload();
  };
  const remove = async (id: string) => {
    if (!await confirm("Delete this property? This cannot be undone.")) return;
    await del("properties", id); reload(); toast("Removed");
  };
  return (
    <div>
      <div class="rt-card-header">
        <div class="rt-card-title">Properties ({properties.length})</div>
        <button class="rt-btn rt-btn-primary rt-btn-sm" onClick={() => setModal(true)}>+ Add Property</button>
      </div>
      {properties.length === 0 ? (
        <div class="rt-empty"><div class="rt-empty-icon">🏘️</div><div>No properties yet.</div></div>
      ) : (
        <div class="rt-grid">
          {properties.map(p => (
            <div class="rt-card" key={p.id}>
              <div class="flex justify-between items-center mb-2">
                <div style="font-size:20px">🏠</div>
                <button class="rt-btn rt-btn-danger rt-btn-sm" onClick={() => remove(p.id)}>Remove</button>
              </div>
              <div class="font-bold" style="font-size:15px">{p.name}</div>
              <div class="text-dim text-sm mt-1">{p.address}</div>
              <div class="text-sm mt-2">{p.units} unit{p.units !== 1 ? "s" : ""}</div>
            </div>
          ))}
        </div>
      )}
      {modal && (
        <Modal title="Add Property" onClose={() => setModal(false)}>
          <div class="rt-form">
            <div class="rt-field"><label class="rt-label">Property Name</label><input class="rt-input" value={form.name} onInput={e => setForm(f => ({ ...f, name: (e.target as HTMLInputElement).value }))} placeholder="e.g. Maple Street House" /></div>
            <div class="rt-field"><label class="rt-label">Address</label><input class="rt-input" value={form.address} onInput={e => setForm(f => ({ ...f, address: (e.target as HTMLInputElement).value }))} placeholder="123 Main St, City, WV" /></div>
            <div class="rt-field"><label class="rt-label">Units</label><input class="rt-input" type="number" inputMode="numeric" value={form.units} onInput={e => setForm(f => ({ ...f, units: (e.target as HTMLInputElement).value }))} /></div>
            <button class="rt-btn rt-btn-primary w-full mt-2" onClick={save}>Save Property</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function RentersTab({ renters, properties, reload }: { renters: Renter[]; properties: Property[]; reload: () => void }) {
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", propertyId: "", unit: "", rentAmount: "", rentFrequency: "monthly", dueDay: "1", pin: "" });
  const save = async () => {
    if (!form.name || !form.propertyId || !form.rentAmount) { toast("Name, property, and rent required", "error"); return; }
    if (form.pin && (form.pin.length !== 4 || !/^\d{4}$/.test(form.pin))) { toast("PIN must be exactly 4 digits", "error"); return; }
    await post("renters", { ...form, rentAmount: parseFloat(form.rentAmount), dueDay: parseInt(form.dueDay), pin: form.pin || null });
    toast("Renter added"); setModal(false); setForm({ name: "", email: "", propertyId: "", unit: "", rentAmount: "", rentFrequency: "monthly", dueDay: "1", pin: "" }); reload();
  };
  const remove = async (id: string) => {
    if (!await confirm("Delete this renter?")) return;
    await del("renters", id); reload(); toast("Removed");
  };
  const propName = (id: string) => properties.find(p => p.id === id)?.name ?? "—";
  return (
    <div>
      <div class="rt-card-header">
        <div class="rt-card-title">Renters ({renters.length})</div>
        <button class="rt-btn rt-btn-primary rt-btn-sm" onClick={() => setModal(true)}>+ Add Renter</button>
      </div>
      {renters.length === 0 ? (
        <div class="rt-empty"><div class="rt-empty-icon">👤</div><div>No renters yet.</div></div>
      ) : (
        <div class="rt-table-wrap">
          <table class="rt-table">
            <thead><tr><th>Name</th><th>Property</th><th>Unit</th><th>Rent</th><th>Freq</th><th>Due</th><th>PIN</th><th></th></tr></thead>
            <tbody>
              {renters.map(r => (
                <tr key={r.id}>
                  <td>{r.name}</td><td>{propName(r.propertyId)}</td><td>{r.unit||"—"}</td>
                  <td style="color:var(--rt-teal);font-weight:600">{fmt(r.rentAmount)}</td>
                  <td style="text-transform:capitalize">{r.rentFrequency || "monthly"}</td>
                  <td>{(r.rentFrequency==="weekly") ? WEEKDAYS[(r.dueDay||1)-1] : `Day ${r.dueDay}`}</td>
                  <td>{r.pin ? "••••" : <span class="text-dim">None</span>}</td>
                  <td><button class="rt-btn rt-btn-danger rt-btn-sm" onClick={() => remove(r.id)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modal && (
        <Modal title="Add Renter" onClose={() => setModal(false)}>
          <div class="rt-form">
            <div class="rt-field"><label class="rt-label">Full Name</label><input class="rt-input" value={form.name} onInput={e => setForm(f => ({ ...f, name: (e.target as HTMLInputElement).value }))} placeholder="Jane Smith" /></div>
            <div class="rt-field"><label class="rt-label">Email</label><input class="rt-input" type="email" value={form.email} onInput={e => setForm(f => ({ ...f, email: (e.target as HTMLInputElement).value }))} placeholder="jane@email.com" /></div>
            <div class="rt-field">
              <label class="rt-label">Property</label>
              <select class="rt-select" value={form.propertyId} onChange={e => setForm(f => ({ ...f, propertyId: (e.target as HTMLSelectElement).value }))}>
                <option value="">Select property...</option>
                {properties.map(p => <option value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div class="rt-form-row">
              <div class="rt-field"><label class="rt-label">Unit</label><input class="rt-input" value={form.unit} onInput={e => setForm(f => ({ ...f, unit: (e.target as HTMLInputElement).value }))} placeholder="2B" /></div>
              <div class="rt-field">
                <label class="rt-label">Frequency</label>
                <select class="rt-select" value={form.rentFrequency} onChange={e => setForm(f => ({ ...f, rentFrequency: (e.target as HTMLSelectElement).value, dueDay: "1" }))}>
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
            </div>
            <div class="rt-form-row">
              <div class="rt-field" style="flex:2">
                <label class="rt-label">Rent Amount</label>
                <input class="rt-input" type="number" inputMode="decimal" value={form.rentAmount} onInput={e => setForm(f => ({ ...f, rentAmount: (e.target as HTMLInputElement).value }))} placeholder="1200.00" />
              </div>
              <div class="rt-field" style="flex:1">
                {form.rentFrequency === "weekly" ? (
                  <>
                    <label class="rt-label">Due Day</label>
                    <select class="rt-select" value={form.dueDay} onChange={e => setForm(f => ({ ...f, dueDay: (e.target as HTMLSelectElement).value }))}>
                      {WEEKDAYS.map((d,i) => <option value={String(i+1)}>{d}</option>)}
                    </select>
                  </>
                ) : (
                  <>
                    <label class="rt-label">Due Day</label>
                    <input class="rt-input" type="number" inputMode="numeric" value={form.dueDay} min="1" max="31" onInput={e => setForm(f => ({ ...f, dueDay: (e.target as HTMLInputElement).value }))} />
                  </>
                )}
              </div>
            </div>
            <div class="rt-field">
              <label class="rt-label">Portal PIN <span style="font-weight:400;opacity:0.6">(optional — renter can set on first login)</span></label>
              <input class="rt-input" type="password" inputMode="numeric" maxLength={4} value={form.pin} onInput={e => setForm(f => ({ ...f, pin: (e.target as HTMLInputElement).value }))} placeholder="Leave blank for self-setup" />
            </div>
            <button class="rt-btn rt-btn-primary w-full mt-2" onClick={save}>Save Renter</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function PaymentsTab({ payments, renters, reload }: { payments: Payment[]; renters: Renter[]; reload: () => void }) {
  const today = new Date().toISOString().slice(0,10);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ renterId: "", amount: "", date: today, paidThrough: "", status: "paid", note: "" });
  const setRenter = (id: string) => {
    const r = renters.find(x => x.id === id);
    setForm(f => ({ ...f, renterId: id, amount: r ? String(r.rentAmount) : f.amount, paidThrough: paidThroughDefault(r, f.date) }));
  };
  const setDate = (date: string) => {
    const r = renters.find(x => x.id === form.renterId);
    setForm(f => ({ ...f, date, paidThrough: paidThroughDefault(r, date) }));
  };
  const save = async () => {
    if (!form.renterId || !form.amount) { toast("Renter and amount required", "error"); return; }
    await post("payments", { ...form, amount: parseFloat(form.amount) });
    toast("Payment logged"); setModal(false); setForm({ renterId: "", amount: "", date: today, paidThrough: "", status: "paid", note: "" }); reload();
  };
  const renterName = (id: string) => renters.find(r => r.id === id)?.name ?? "Unknown";
  const total = payments.filter(p => p.status === "paid").reduce((s,p) => s+p.amount, 0);
  const pending = payments.filter(p => p.status === "pending").reduce((s,p) => s+p.amount, 0);
  return (
    <div>
      <div class="rt-stats">
        <div class="rt-stat"><div class="rt-stat-label">Total Collected</div><div class="rt-stat-value teal">{fmt(total)}</div></div>
        <div class="rt-stat"><div class="rt-stat-label">Pending</div><div class="rt-stat-value amber">{fmt(pending)}</div></div>
        <div class="rt-stat"><div class="rt-stat-label">Transactions</div><div class="rt-stat-value">{payments.length}</div></div>
      </div>
      <div class="rt-card-header">
        <div class="rt-card-title">Payment History</div>
        <button class="rt-btn rt-btn-primary rt-btn-sm" onClick={() => setModal(true)}>+ Log Payment</button>
      </div>
      {payments.length === 0 ? (
        <div class="rt-empty"><div class="rt-empty-icon">💳</div><div>No payments logged yet.</div></div>
      ) : (
        <div class="rt-table-wrap">
          <table class="rt-table">
            <thead><tr><th>Date</th><th>Renter</th><th>Amount</th><th>Paid Through</th><th>Status</th><th>Note</th></tr></thead>
            <tbody>
              {[...payments].sort((a,b) => b.date.localeCompare(a.date)).map(p => (
                <tr key={p.id}>
                  <td>{p.date}</td><td>{renterName(p.renterId)}</td>
                  <td style="font-weight:600">{fmt(p.amount)}</td>
                  <td style="color:var(--rt-teal);font-weight:500">{p.paidThrough || "—"}</td>
                  <td><span class={`rt-badge ${p.status==="paid"?"rt-badge-success":p.status==="pending"?"rt-badge-warning":"rt-badge-danger"}`}>{p.status}</span></td>
                  <td class="text-dim">{p.note||"—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modal && (
        <Modal title="Log Payment" onClose={() => setModal(false)}>
          <div class="rt-form">
            <div class="rt-field">
              <label class="rt-label">Renter</label>
              <select class="rt-select" value={form.renterId} onChange={e => setRenter((e.target as HTMLSelectElement).value)}>
                <option value="">Select renter...</option>
                {renters.map(r => <option value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div class="rt-form-row">
              <div class="rt-field"><label class="rt-label">Amount</label><input class="rt-input" type="number" inputMode="decimal" value={form.amount} onInput={e => setForm(f=>({...f,amount:(e.target as HTMLInputElement).value}))} /></div>
              <div class="rt-field"><label class="rt-label">Payment Date</label><input class="rt-input" type="date" value={form.date} onInput={e => setDate((e.target as HTMLInputElement).value)} /></div>
            </div>
            <div class="rt-field">
              <label class="rt-label">Paid Through</label>
              <input class="rt-input" type="date" value={form.paidThrough} onInput={e => setForm(f=>({...f,paidThrough:(e.target as HTMLInputElement).value}))} />
              <div style="font-size:12px;color:var(--rt-muted);margin-top:4px">Auto-filled based on renter's frequency — adjust if needed.</div>
            </div>
            <div class="rt-field">
              <label class="rt-label">Status</label>
              <select class="rt-select" value={form.status} onChange={e => setForm(f=>({...f,status:(e.target as HTMLSelectElement).value}))}>
                <option value="paid">Paid</option><option value="pending">Pending</option><option value="late">Late</option>
              </select>
            </div>
            <div class="rt-field"><label class="rt-label">Note</label><input class="rt-input" value={form.note} onInput={e => setForm(f=>({...f,note:(e.target as HTMLInputElement).value}))} placeholder="e.g. Venmo transfer" /></div>
            <button class="rt-btn rt-btn-primary w-full mt-2" onClick={save}>Save Payment</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function AllocationsTab({ allocations, reload }: { allocations: Allocation[]; reload: () => void }) {
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ label: "", pct: "" });
  const total = allocations.reduce((s,a) => s+a.pct, 0);
  const remaining = 100 - total;
  const save = async () => {
    const pct = parseFloat(form.pct);
    if (!form.label || isNaN(pct) || pct <= 0) { toast("Label and percentage required", "error"); return; }
    if (pct > remaining) { toast(`Only ${remaining.toFixed(1)}% remaining`, "error"); return; }
    await post("allocations", { label: form.label, pct, color: COLORS[allocations.length % COLORS.length] });
    toast("Allocation added"); setModal(false); setForm({ label: "", pct: "" }); reload();
  };
  const remove = async (id: string) => { await del("allocations", id); reload(); toast("Removed"); };
  return (
    <div>
      <div class="rt-card-header">
        <div class="rt-card-title">Fund Allocations</div>
        <button class="rt-btn rt-btn-primary rt-btn-sm" onClick={() => setModal(true)}>+ Add</button>
      </div>
      <div class="rt-stat" style="margin-bottom:16px">
        <div class="rt-stat-label">Allocated</div>
        <div class="rt-stat-value" style={`color:${total>=100?"var(--rt-teal)":"var(--rt-amber)"}`}>{total.toFixed(1)}% / 100%</div>
      </div>
      {allocations.length > 0 && (
        <div class="rt-alloc-bar" style="margin-bottom:20px">
          {allocations.map(a => <div class="rt-alloc-seg" style={`width:${a.pct}%;background:${a.color}`} key={a.id} />)}
          {remaining > 0 && <div class="rt-alloc-seg" style={`width:${remaining}%;background:rgba(255,255,255,0.08)`} />}
        </div>
      )}
      {allocations.length === 0 ? (
        <div class="rt-empty"><div class="rt-empty-icon">🥧</div><div>No allocations set yet.</div></div>
      ) : (
        <div class="rt-alloc-list">
          {allocations.map(a => (
            <div class="rt-alloc-item" key={a.id}>
              <div class="rt-alloc-label"><div class="rt-alloc-dot" style={`background:${a.color}`} />{a.label} <span class="rt-alloc-pct">({a.pct}%)</span></div>
              <button class="rt-btn rt-btn-danger rt-btn-sm" onClick={() => remove(a.id)}>✕</button>
            </div>
          ))}
        </div>
      )}
      {modal && (
        <Modal title="Add Allocation" onClose={() => setModal(false)}>
          <div class="rt-form">
            <div class="rt-field"><label class="rt-label">Label</label><input class="rt-input" value={form.label} onInput={e => setForm(f=>({...f,label:(e.target as HTMLInputElement).value}))} placeholder="e.g. Mortgage, Taxes" /></div>
            <div class="rt-field"><label class="rt-label">Percentage (remaining: {remaining.toFixed(1)}%)</label><input class="rt-input" type="number" inputMode="decimal" value={form.pct} onInput={e => setForm(f=>({...f,pct:(e.target as HTMLInputElement).value}))} /></div>
            <button class="rt-btn rt-btn-primary w-full mt-2" onClick={save}>Save Allocation</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function PayMethodRow({ pm, saved, reload }: {
  pm: typeof PAY_METHODS[0];
  saved: PayMethod | undefined;
  reload: () => void;
}) {
  const [localHandle, setLocalHandle] = useState(saved?.handle ?? "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const enabled = saved?.enabled ?? false;
  const hasHandle = !!(saved?.handle);

  const toggle = async () => {
    if (!saved) return;
    await apiFetch(`${API("payMethods")}&id=${saved.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !enabled }) });
    reload();
  };

  const saveHandle = async () => {
    if (!localHandle.trim()) return;
    setSaving(true);
    if (saved) {
      await apiFetch(`${API("payMethods")}&id=${saved.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handle: localHandle.trim() }) });
    } else {
      await apiFetch(API("payMethods"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ method: pm.key, handle: localHandle.trim(), enabled: true }) });
    }
    reload(); setSaving(false); setEditing(false); toast("Saved");
  };

  return (
    <div class="rt-card" style="padding:14px 16px;margin-bottom:0">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:20px">{pm.icon}</span>
        <div style="flex:1">
          <div style="font-weight:600;font-size:14px">{pm.label}</div>
          {pm.linkTemplate && <div style="font-size:11px;color:var(--rt-muted)">Direct link available</div>}
        </div>
        {hasHandle && (
          <div style="display:flex;align-items:center;gap:6px;font-size:13px">
            <span style="color:var(--rt-muted)">{enabled?"On":"Off"}</span>
            <div style={`width:36px;height:20px;border-radius:10px;background:${enabled?"var(--rt-teal)":"rgba(255,255,255,0.15)"};cursor:pointer;position:relative;transition:background 0.2s`} onClick={toggle}>
              <div style={`position:absolute;top:3px;width:14px;height:14px;border-radius:50%;background:white;transition:left 0.2s;left:${enabled?"19px":"3px"}`} />
            </div>
          </div>
        )}
        <button class="rt-btn rt-btn-ghost rt-btn-sm" onClick={() => { setLocalHandle(saved?.handle ?? ""); setEditing(e => !e); }}>
          {editing ? "Cancel" : hasHandle ? "Edit" : "Set Up"}
        </button>
      </div>
      {hasHandle && !editing && (
        <div style="font-size:13px;color:var(--rt-muted);margin-top:6px;padding-top:8px;border-top:1px solid var(--rt-border)">
          Handle: <span style="color:var(--rt-text)">{saved!.handle}</span>
        </div>
      )}
      {editing && (
        <div style="margin-top:10px;display:flex;gap:8px">
          <input class="rt-input" style="flex:1" placeholder={
            pm.key==="cashapp" ? "$YourCashTag" :
            pm.key==="paypal"  ? "YourPayPalUsername" :
            pm.key==="zelle"   ? "phone or email" :
            pm.key==="applepay"? "phone number" :
            pm.key==="chime"   ? "username or phone" : "username or phone"
          } value={localHandle}
            onInput={e => setLocalHandle((e.target as HTMLInputElement).value)}
            onKeyDown={e => { if (e.key==="Enter" && localHandle.trim()) saveHandle(); }}
          />
          <button class="rt-btn rt-btn-primary rt-btn-sm" disabled={!localHandle.trim()||saving} onClick={saveHandle}>
            {saving ? "..." : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}

function PayMethodsTab({ payMethods, reload }: { payMethods: PayMethod[]; reload: () => void }) {
  return (
    <div>
      <div class="rt-card-header">
        <div class="rt-card-title">Payment Methods</div>
        <div style="font-size:13px;color:var(--rt-muted)">Configure how renters can pay you</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px;margin-top:8px">
        {PAY_METHODS.map(pm => (
          <PayMethodRow key={pm.key} pm={pm} saved={payMethods.find(m => m.method === pm.key)} reload={reload} />
        ))}
      </div>
    </div>
  );
}

function BillsTab({ bills, properties, reload }: { bills: Bill[]; properties: Property[]; reload: () => void }) {
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name: "", propertyId: "", amount: "", dueDate: "", frequency: "monthly", status: "pending", notes: "" });
  const save = async () => {
    if (!form.name || !form.amount) { toast("Name and amount required", "error"); return; }
    await post("bills", { ...form, amount: parseFloat(form.amount) });
    toast("Bill added"); setModal(false); setForm({ name: "", propertyId: "", amount: "", dueDate: "", frequency: "monthly", status: "pending", notes: "" }); reload();
  };
  const remove = async (id: string) => {
    if (!await confirm("Delete this bill?")) return;
    await del("bills", id); reload(); toast("Removed");
  };
  const updateStatus = async (bill: Bill, status: string) => {
    await apiFetch(`${API("bills")}&id=${bill.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    reload(); toast("Status updated");
  };
  const propName = (id: string) => properties.find(p => p.id === id)?.name ?? "—";
  const totalMonthly = bills.filter(b => b.frequency === "monthly").reduce((s,b) => s+b.amount, 0);
  const totalAnnual = bills.reduce((s,b) => {
    if (b.frequency === "monthly") return s + b.amount * 12;
    if (b.frequency === "annual") return s + b.amount;
    return s + b.amount;
  }, 0);

  return (
    <div>
      <div class="rt-stats">
        <div class="rt-stat"><div class="rt-stat-label">Monthly Bills</div><div class="rt-stat-value teal">{fmt(totalMonthly)}</div></div>
        <div class="rt-stat"><div class="rt-stat-label">Annual Total</div><div class="rt-stat-value amber">{fmt(totalAnnual)}</div></div>
        <div class="rt-stat"><div class="rt-stat-label">Total Bills</div><div class="rt-stat-value">{bills.length}</div></div>
      </div>
      <div class="rt-card-header">
        <div class="rt-card-title">Bills ({bills.length})</div>
        <button class="rt-btn rt-btn-primary rt-btn-sm" onClick={() => setModal(true)}>+ Add Bill</button>
      </div>
      {bills.length === 0 ? (
        <div class="rt-empty"><div class="rt-empty-icon">🧾</div><div>No bills added yet.</div></div>
      ) : (
        <div class="rt-table-wrap">
          <table class="rt-table">
            <thead><tr><th>Bill</th><th>Property</th><th>Amount</th><th>Frequency</th><th>Due Date</th><th>Status</th><th>Notes</th><th></th></tr></thead>
            <tbody>
              {bills.map(b => (
                <tr key={b.id}>
                  <td style="font-weight:600">{b.name}</td>
                  <td>{propName(b.propertyId)}</td>
                  <td style="color:var(--rt-teal);font-weight:600">{fmt(b.amount)}</td>
                  <td style="text-transform:capitalize">{b.frequency}</td>
                  <td>{b.dueDate || "—"}</td>
                  <td>
                    <select class="rt-select" style="padding:4px 8px;font-size:12px;min-height:unset" value={b.status} onChange={e => updateStatus(b, (e.target as HTMLSelectElement).value)}>
                      <option value="paid">Paid</option>
                      <option value="pending">Pending</option>
                      <option value="overdue">Overdue</option>
                    </select>
                  </td>
                  <td class="text-dim">{b.notes || "—"}</td>
                  <td><button class="rt-btn rt-btn-danger rt-btn-sm" onClick={() => remove(b.id)}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modal && (
        <Modal title="Add Bill" onClose={() => setModal(false)}>
          <div class="rt-form">
            <div class="rt-field"><label class="rt-label">Bill Name</label><input class="rt-input" value={form.name} onInput={e => setForm(f=>({...f,name:(e.target as HTMLInputElement).value}))} placeholder="e.g. Electric, Mortgage, Insurance" /></div>
            <div class="rt-field">
              <label class="rt-label">Property (optional)</label>
              <select class="rt-select" value={form.propertyId} onChange={e => setForm(f=>({...f,propertyId:(e.target as HTMLSelectElement).value}))}>
                <option value="">All properties / General</option>
                {properties.map(p => <option value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div class="rt-form-row">
              <div class="rt-field"><label class="rt-label">Amount</label><input class="rt-input" type="number" inputMode="decimal" value={form.amount} onInput={e => setForm(f=>({...f,amount:(e.target as HTMLInputElement).value}))} placeholder="0.00" /></div>
              <div class="rt-field">
                <label class="rt-label">Frequency</label>
                <select class="rt-select" value={form.frequency} onChange={e => setForm(f=>({...f,frequency:(e.target as HTMLSelectElement).value}))}>
                  <option value="monthly">Monthly</option>
                  <option value="annual">Annual</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="one-time">One-time</option>
                </select>
              </div>
            </div>
            <div class="rt-form-row">
              <div class="rt-field"><label class="rt-label">Due Date</label><input class="rt-input" type="date" value={form.dueDate} onInput={e => setForm(f=>({...f,dueDate:(e.target as HTMLInputElement).value}))} /></div>
              <div class="rt-field">
                <label class="rt-label">Status</label>
                <select class="rt-select" value={form.status} onChange={e => setForm(f=>({...f,status:(e.target as HTMLSelectElement).value}))}>
                  <option value="pending">Pending</option>
                  <option value="paid">Paid</option>
                  <option value="overdue">Overdue</option>
                </select>
              </div>
            </div>
            <div class="rt-field"><label class="rt-label">Notes</label><input class="rt-input" value={form.notes} onInput={e => setForm(f=>({...f,notes:(e.target as HTMLInputElement).value}))} placeholder="e.g. Auto-pay, account #" /></div>
            <button class="rt-btn rt-btn-primary w-full mt-2" onClick={save}>Save Bill</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Resize image to max 200x200 JPEG base64
function resizeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 200;
      const scale = Math.min(MAX / img.width, MAX / img.height, 1);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.75));
    };
    img.onerror = reject;
    img.src = url;
  });
}

function ProfileModal({ renter, onClose, onSaved }: { renter: Renter; onClose: () => void; onSaved: (updated: Partial<Renter>) => void }) {
  const [name, setName] = useState(renter.name);
  const [email, setEmail] = useState(renter.email || "");
  const [phone, setPhone] = useState(renter.phone || "");
  const [photo, setPhoto] = useState(renter.photo || "");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const handlePhoto = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    setUploading(true);
    try { setPhoto(await resizeImage(file)); } catch { toast("Photo upload failed", "error"); }
    setUploading(false);
  };

  const save = async () => {
    if (!name.trim()) { toast("Name is required", "error"); return; }
    setSaving(true);
    const updates: Partial<Renter> = { name: name.trim(), email, phone, photo };
    await apiFetch(`${API("renters")}&id=${renter.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    toast("Profile updated ✓");
    onSaved(updates);
    setSaving(false);
    onClose();
  };

  return (
    <Modal title="Edit Profile" onClose={onClose}>
      <div class="rt-form">
        <div style="display:flex;flex-direction:column;align-items:center;gap:10px;margin-bottom:16px">
          <div style={`width:90px;height:90px;border-radius:50%;background:rgba(255,255,255,0.08);border:2px solid var(--rt-border);overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:36px`}>
            {photo ? <img src={photo} style="width:100%;height:100%;object-fit:cover" /> : "🧑"}
          </div>
          <label style="cursor:pointer">
            <span class="rt-btn rt-btn-ghost rt-btn-sm">{uploading ? "Uploading..." : photo ? "Change Photo" : "Upload Photo"}</span>
            <input type="file" accept="image/*" style="display:none" onChange={handlePhoto} disabled={uploading} />
          </label>
          {photo && <button class="rt-btn rt-btn-ghost rt-btn-sm" style="opacity:0.5;font-size:12px" onClick={() => setPhoto("")}>Remove photo</button>}
        </div>
        <div class="rt-field"><label class="rt-label">Display Name</label><input class="rt-input" value={name} onInput={e => setName((e.target as HTMLInputElement).value)} /></div>
        <div class="rt-field"><label class="rt-label">Email</label><input class="rt-input" type="email" value={email} onInput={e => setEmail((e.target as HTMLInputElement).value)} placeholder="your@email.com" /></div>
        <div class="rt-field"><label class="rt-label">Phone</label><input class="rt-input" type="tel" value={phone} onInput={e => setPhone((e.target as HTMLInputElement).value)} placeholder="(304) 555-0100" /></div>
        <button class="rt-btn rt-btn-primary w-full mt-2" onClick={save} disabled={saving || uploading}>{saving ? "Saving..." : "Save Profile"}</button>
      </div>
    </Modal>
  );
}

function ChatCard({ renter, propertyName }: { renter: Renter; propertyName: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = { current: null as HTMLDivElement | null };

  const load = () => apiFetch(`${API("messages")}`).then(r => r.json())
    .then((all: Message[]) => setMessages(all.filter(m => m.propertyId === renter.propertyId).sort((a,b) => a.createdAt.localeCompare(b.createdAt))))
    .catch(() => {});

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [renter.propertyId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    await apiFetch(API("messages"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ renterId: renter.id, renterName: renter.name, propertyId: renter.propertyId, text: text.trim() }),
    });
    setText(""); setSending(false); load();
  };

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };

  return (
    <div class="rt-card" style="margin-bottom:16px">
      <div class="rt-card-title" style="margin-bottom:12px">💬 House Chat <span style="font-size:12px;font-weight:400;color:var(--rt-muted);margin-left:6px">{propertyName}</span></div>
      <div style="max-height:320px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;margin-bottom:12px;padding-right:4px">
        {messages.length === 0 && <div class="rt-empty" style="padding:24px 0"><div class="rt-empty-icon">💬</div><div>No messages yet. Say hi!</div></div>}
        {messages.map(m => {
          const isMe = m.renterId === renter.id;
          return (
            <div key={m.id} style={`display:flex;flex-direction:column;align-items:${isMe?"flex-end":"flex-start"}`}>
              <div style={`max-width:80%;padding:8px 12px;border-radius:${isMe?"12px 12px 4px 12px":"12px 12px 12px 4px"};background:${isMe?"var(--rt-teal)":"rgba(255,255,255,0.08)"};color:${isMe?"#0a1628":"var(--rt-text)"};font-size:14px;line-height:1.4`}>
                {m.text}
              </div>
              <div style="font-size:11px;color:var(--rt-muted);margin-top:2px;padding:0 4px">
                {!isMe && <span style="font-weight:600;margin-right:4px">{m.renterName}</span>}
                {fmtTime(m.createdAt)}
              </div>
            </div>
          );
        })}
        <div ref={(el) => { bottomRef.current = el as HTMLDivElement; }} />
      </div>
      <div style="display:flex;gap:8px">
        <input class="rt-input" style="flex:1" placeholder="Type a message..." value={text}
          onInput={e => setText((e.target as HTMLInputElement).value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <button class="rt-btn rt-btn-primary rt-btn-sm" onClick={send} disabled={!text.trim() || sending} style="min-width:60px">
          {sending ? "..." : "Send"}
        </button>
      </div>
    </div>
  );
}

function AdminChatTab({ messages, renters, properties, reload }: { messages: Message[]; renters: Renter[]; properties: Property[]; reload: () => void }) {
  const [adminText, setAdminText] = useState("");
  const [propId, setPropId] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!adminText.trim() || !propId || sending) return;
    setSending(true);
    await apiFetch(API("messages"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ renterId: "admin", renterName: "Admin", propertyId: propId, text: adminText.trim(), isAdmin: true }),
    });
    setAdminText(""); setSending(false); reload();
  };

  const fmtTime = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const propName = (id: string) => properties.find(p => p.id === id)?.name ?? "Unknown";

  const grouped = properties.map(p => ({
    property: p,
    msgs: messages.filter(m => m.propertyId === p.id).sort((a,b) => a.createdAt.localeCompare(b.createdAt)),
  })).filter(g => g.msgs.length > 0);

  return (
    <div>
      <div class="rt-card-header">
        <div class="rt-card-title">House Chat</div>
      </div>
      <div class="rt-card" style="margin-bottom:16px;padding:14px 16px">
        <div class="rt-card-title" style="font-size:13px;margin-bottom:10px">Send message as Admin</div>
        <div style="display:flex;gap:8px;margin-bottom:8px">
          <select class="rt-select" style="flex:1" value={propId} onChange={e => setPropId((e.target as HTMLSelectElement).value)}>
            <option value="">Select property...</option>
            {properties.map(p => <option value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div style="display:flex;gap:8px">
          <input class="rt-input" style="flex:1" placeholder="Type a message to renters..." value={adminText}
            onInput={e => setAdminText((e.target as HTMLInputElement).value)}
            onKeyDown={e => { if (e.key==="Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <button class="rt-btn rt-btn-primary rt-btn-sm" onClick={send} disabled={!adminText.trim()||!propId||sending}>{sending?"...":"Send"}</button>
        </div>
      </div>
      {grouped.length === 0 && <div class="rt-empty"><div class="rt-empty-icon">💬</div><div>No messages yet.</div></div>}
      {grouped.map(g => (
        <div key={g.property.id} class="rt-card" style="margin-bottom:16px">
          <div class="rt-card-title" style="margin-bottom:12px">🏘️ {g.property.name}</div>
          <div style="display:flex;flex-direction:column;gap:8px">
            {g.msgs.map(m => (
              <div key={m.id} style="display:flex;gap:10px;align-items:flex-start">
                <div style={`width:32px;height:32px;border-radius:50%;background:${m.isAdmin?"var(--rt-teal)":"rgba(255,255,255,0.1)"};display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0`}>
                  {m.isAdmin ? "🔑" : (renters.find(r => r.id === m.renterId)?.photo ? <img src={renters.find(r => r.id === m.renterId)!.photo} style="width:100%;height:100%;object-fit:cover;border-radius:50%" /> : "🧑")}
                </div>
                <div style="flex:1">
                  <div style="font-size:12px;color:var(--rt-muted);margin-bottom:2px">
                    <span style="font-weight:600;color:var(--rt-text)">{m.renterName}</span> · {fmtTime(m.createdAt)}
                  </div>
                  <div style="font-size:14px">{m.text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AdminAuth({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState("");
  const [confirm2, setConfirm2] = useState("");
  const [error, setError] = useState("");
  const stored = localStorage.getItem("rt_admin_pin");
  const isFirstTime = !stored;
  const handleSubmit = () => {
    if (isFirstTime) {
      if (pin.length !== 4 || !/^\d{4}$/.test(pin)) { setError("PIN must be exactly 4 digits."); return; }
      if (pin !== confirm2) { setError("PINs don't match."); return; }
      localStorage.setItem("rt_admin_pin", pin); onUnlock();
    } else {
      if (pin === stored) onUnlock();
      else { setError("Incorrect PIN."); setPin(""); }
    }
  };
  return (
    <div class="rt-login">
      <div style="font-size:32px;margin-bottom:12px">🔐</div>
      <div class="rt-login-title">Admin Access</div>
      <div class="rt-login-sub">{isFirstTime ? "Set a 4-digit PIN to protect the admin panel." : "Enter your admin PIN to continue."}</div>
      <div class="rt-form">
        <div class="rt-field">
          <label class="rt-label">{isFirstTime ? "Create PIN" : "Admin PIN"}</label>
          <input class="rt-input" type="password" inputMode="numeric" maxLength={4} placeholder="••••" value={pin}
            onInput={e => { setPin((e.target as HTMLInputElement).value); setError(""); }}
            onKeyDown={e => { if (e.key==="Enter" && !isFirstTime) handleSubmit(); }}
          />
        </div>
        {isFirstTime && (
          <div class="rt-field">
            <label class="rt-label">Confirm PIN</label>
            <input class="rt-input" type="password" inputMode="numeric" maxLength={4} placeholder="••••" value={confirm2}
              onInput={e => { setConfirm2((e.target as HTMLInputElement).value); setError(""); }}
              onKeyDown={e => { if (e.key==="Enter") handleSubmit(); }}
            />
          </div>
        )}
        {error && <div style="color:var(--rt-rose);font-size:13px">{error}</div>}
        <button class="rt-btn rt-btn-primary w-full" onClick={handleSubmit} disabled={isFirstTime ? pin.length!==4||confirm2.length!==4 : pin.length!==4}>
          {isFirstTime ? "Set PIN & Enter" : "Unlock"}
        </button>
      </div>
    </div>
  );
}

function AdminPanel({ onExit }: { onExit: () => void }) {
  const [properties,,reloadProps] = useData<Property>("properties");
  const [renters,,reloadRenters] = useData<Renter>("renters");
  const [payments,,reloadPayments] = useData<Payment>("payments");
  const [allocations,,reloadAllocs] = useData<Allocation>("allocations");
  const [bills,,reloadBills] = useData<Bill>("bills");
  const [payMethods,,reloadPayMethods] = useData<PayMethod>("payMethods");
  const [messages,,reloadMessages] = useData<Message>("messages");
  const [tab, setTab] = useState("properties");
  return (
    <div>
      <div class="rt-tabs" style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">
        {[["properties","🏘️ Properties"],["renters","👤 Renters"],["payments","💳 Payments"],["allocations","🥧 Allocations"],["bills","🧾 Bills"],["paymethods","💸 Pay Methods"],["chat","💬 Chat"]].map(([id,label]) => (
          <button key={id} class={`rt-tab${tab===id?" active":""}`} onClick={() => setTab(id)}>{label}</button>
        ))}
        <button class="rt-btn rt-btn-ghost rt-btn-sm" style="margin-left:auto;white-space:nowrap" onClick={onExit}>← Renter Portal</button>
      </div>
      {tab==="properties" && <PropertiesTab properties={properties} reload={reloadProps} />}
      {tab==="renters" && <RentersTab renters={renters} properties={properties} reload={reloadRenters} />}
      {tab==="payments" && <PaymentsTab payments={payments} renters={renters} reload={reloadPayments} />}
      {tab==="allocations" && <AllocationsTab allocations={allocations} reload={reloadAllocs} />}
      {tab==="bills" && <BillsTab bills={bills} properties={properties} reload={reloadBills} />}
      {tab==="paymethods" && <PayMethodsTab payMethods={payMethods} reload={reloadPayMethods} />}
      {tab==="chat" && <AdminChatTab messages={messages} renters={renters} properties={properties} reload={reloadMessages} />}
    </div>
  );
}

function RenterPortal({ renters, properties, payments, allocations, bills, reloadBills, payMethods, onAdminLogin, reloadRenters }: { renters: Renter[]; properties: Property[]; payments: Payment[]; allocations: Allocation[]; bills: Bill[]; reloadBills: () => void; payMethods: PayMethod[]; onAdminLogin: () => void; reloadRenters: () => void }) {
  const [renterId, setRenterId] = useState("");
  const [pinInput, setPinInput] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [pinError, setPinError] = useState(false);
  const [pinSaving, setPinSaving] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [billToMark, setBillToMark] = useState<Bill | null>(null);
  const [confirmNum, setConfirmNum] = useState("");
  const [markingPaid, setMarkingPaid] = useState(false);
  const selectedRenter = renters.find(r => r.id === renterId);
  const noPin = !!selectedRenter && !selectedRenter.pin;
  const handlePinSubmit = () => {
    if (!selectedRenter) return;
    if (pinInput === String(selectedRenter.pin)) { setUnlocked(true); setPinError(false); }
    else { setPinError(true); setPinInput(""); toast("Incorrect PIN", "error"); }
  };
  const handleSetPin = async () => {
    if (pinInput.length !== 4 || !/^\d{4}$/.test(pinInput)) { toast("PIN must be 4 digits", "error"); return; }
    if (pinInput !== pinConfirm) { toast("PINs don't match", "error"); setPinConfirm(""); return; }
    setPinSaving(true);
    await apiFetch(`${API("renters")}&id=${selectedRenter!.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: pinInput }),
    });
    toast("PIN set — you're in! ✓");
    setPinSaving(false);
    setUnlocked(true);
  };
  const handleRenterChange = (id: string) => { setRenterId(id); setPinInput(""); setPinConfirm(""); setPinError(false); setUnlocked(false); };
  const renter = unlocked ? selectedRenter : undefined;
  const property = renter ? properties.find(p => p.id === renter.propertyId) : null;
  const myPayments = payments.filter(p => p.renterId === renterId);
  const paid = myPayments.filter(p => p.status==="paid").reduce((s,p) => s+p.amount, 0);
  const _ptSorted = myPayments.filter(p => p.status==="paid" && p.paidThrough).map(p => p.paidThrough).sort();
  const paidThrough = _ptSorted.length > 0 ? _ptSorted[_ptSorted.length - 1] : null;
  const allTotal = allocations.reduce((s,a) => s+a.pct, 0);
  const myBills = renter ? bills.filter(b => b.propertyId === renter.propertyId) : [];
  const handleMarkPaid = async () => {
    if (!billToMark || !confirmNum.trim()) return;
    setMarkingPaid(true);
    await apiFetch(`${API("bills")}&id=${billToMark.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "paid", confirmationNumber: confirmNum.trim() })
    });
    reloadBills();
    toast("Bill marked as paid ✓");
    setBillToMark(null); setConfirmNum(""); setMarkingPaid(false);
  };

  if (!renterId || !renter) {
    return (
      <div class="rt-portal">
        <div class="rt-login">
          <div class="rt-login-title">Renter Portal</div>
          <div class="rt-login-sub">Select your name to get started. First-time users will create their own PIN.</div>
          <div class="rt-form">
            <div class="rt-field">
              <label class="rt-label">Your Name</label>
              <select class="rt-select" value={renterId} onChange={e => handleRenterChange((e.target as HTMLSelectElement).value)}>
                <option value="">Choose renter...</option>
                {renters.map(r => <option value={r.id}>{r.name}</option>)}
              </select>
            </div>
            {renterId && !unlocked && noPin && (
              <div>
                <div style="background:rgba(56,189,153,0.1);border:1px solid rgba(56,189,153,0.3);border-radius:8px;padding:10px 14px;font-size:13px;color:var(--rt-teal);margin-bottom:12px">
                  First time here? Create a 4-digit PIN to secure your portal.
                </div>
                <div class="rt-field">
                  <label class="rt-label">Create PIN</label>
                  <input class="rt-input" type="password" inputMode="numeric" maxLength={4} placeholder="••••" value={pinInput}
                    onInput={e => setPinInput((e.target as HTMLInputElement).value)}
                    onKeyDown={e => { if (e.key==="Enter" && pinInput.length===4) (document.querySelector("#pin-confirm") as HTMLInputElement)?.focus(); }}
                  />
                </div>
                <div class="rt-field">
                  <label class="rt-label">Confirm PIN</label>
                  <input id="pin-confirm" class="rt-input" type="password" inputMode="numeric" maxLength={4} placeholder="••••" value={pinConfirm}
                    onInput={e => setPinConfirm((e.target as HTMLInputElement).value)}
                    onKeyDown={e => { if (e.key==="Enter" && pinConfirm.length===4) handleSetPin(); }}
                  />
                </div>
                <button class="rt-btn rt-btn-primary w-full mt-2" onClick={handleSetPin} disabled={pinInput.length!==4||pinConfirm.length!==4||pinSaving}>
                  {pinSaving ? "Saving..." : "Set PIN & Enter"}
                </button>
              </div>
            )}
            {renterId && !unlocked && !noPin && (
              <div class="rt-field">
                <label class="rt-label">4-Digit PIN {pinError && <span style="color:var(--rt-rose);margin-left:6px">Incorrect</span>}</label>
                <input class="rt-input" type="password" inputMode="numeric" maxLength={4} placeholder="••••" value={pinInput}
                  onInput={e => { setPinInput((e.target as HTMLInputElement).value); setPinError(false); }}
                  onKeyDown={e => { if (e.key==="Enter") handlePinSubmit(); }}
                  style={pinError?"border-color:var(--rt-rose)":""}
                />
                <button class="rt-btn rt-btn-primary w-full mt-2" onClick={handlePinSubmit} disabled={pinInput.length!==4}>Unlock Portal</button>
              </div>
            )}
          </div>
          {renters.length===0 && <div class="text-dim text-sm mt-2">No renters set up yet.</div>}
          <div style="margin-top:24px;text-align:center">
            <button class="rt-btn rt-btn-ghost rt-btn-sm" onClick={onAdminLogin} style="opacity:0.6;font-size:12px">🔐 Admin Login</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div class="rt-portal">
      <div class="rt-portal-hero">
        <div style="position:relative;display:inline-block;margin-bottom:8px">
          <div style="width:80px;height:80px;border-radius:50%;background:rgba(255,255,255,0.1);border:3px solid var(--rt-teal);overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:36px;margin:0 auto">
            {renter.photo ? <img src={renter.photo} style="width:100%;height:100%;object-fit:cover" /> : "🧑"}
          </div>
          <button onClick={() => setShowProfile(true)} style="position:absolute;bottom:0;right:0;width:26px;height:26px;border-radius:50%;background:var(--rt-teal);border:2px solid #0a1628;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:13px" title="Edit profile">✏️</button>
        </div>
        <div class="rt-portal-name">👋 Hi, {renter.name}</div>
        <div class="rt-portal-prop">{property?.name ?? "—"}{renter.unit ? ` · Unit ${renter.unit}` : ""}</div>
        {renter.phone && <div style="font-size:13px;color:var(--rt-muted);margin-top:2px">{renter.phone}</div>}
        <div class="rt-portal-amount">{fmt(renter.rentAmount)}</div>
        <div class="rt-portal-due">
          {(renter.rentFrequency==="weekly")
            ? `Weekly rent · Due every ${WEEKDAYS[(renter.dueDay||1)-1]}`
            : `Monthly rent · Due on the ${renter.dueDay}${renter.dueDay===1?"st":renter.dueDay===2?"nd":renter.dueDay===3?"rd":"th"}`}
        </div>
        <div style="margin-top:16px;display:flex;gap:16px;justify-content:center;flex-wrap:wrap">
          <div class="rt-stat" style="flex:1;min-width:120px"><div class="rt-stat-label">Total Paid</div><div class="rt-stat-value teal" style="font-size:18px">{fmt(paid)}</div></div>
          <div class="rt-stat" style="flex:1;min-width:120px"><div class="rt-stat-label">Payments</div><div class="rt-stat-value" style="font-size:18px">{myPayments.length}</div></div>
          {paidThrough && (
            <div class="rt-stat" style="flex:1;min-width:140px">
              <div class="rt-stat-label">Paid Through</div>
              <div class="rt-stat-value" style="font-size:16px;color:var(--rt-teal)">{paidThrough}</div>
            </div>
          )}
        </div>
      </div>
      {allocations.length > 0 && (
        <div class="rt-card" style="margin-bottom:16px">
          <div class="rt-card-title" style="margin-bottom:12px">Where Your Rent Goes</div>
          <div class="rt-alloc-bar">
            {allocations.map(a => <div class="rt-alloc-seg" style={`width:${a.pct}%;background:${a.color}`} key={a.id} />)}
            {allTotal < 100 && <div class="rt-alloc-seg" style={`width:${100-allTotal}%;background:rgba(255,255,255,0.08)`} />}
          </div>
          <div class="rt-alloc-list">
            {allocations.map(a => (
              <div class="rt-alloc-item" key={a.id}>
                <div class="rt-alloc-label"><div class="rt-alloc-dot" style={`background:${a.color}`} />{a.label}</div>
                <div class="flex items-center gap-2">
                  <span class="rt-alloc-pct">{a.pct}%</span>
                  <span class="rt-alloc-amt">{fmt(renter.rentAmount * a.pct / 100)}/{renter.rentFrequency==="weekly"?"wk":"mo"}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {payMethods.filter(m => m.enabled && m.handle).length > 0 && (
        <div class="rt-card" style="margin-bottom:16px">
          <div class="rt-card-title" style="margin-bottom:14px">💸 How to Pay</div>
          <div style="display:flex;flex-direction:column;gap:10px">
            {payMethods.filter(m => m.enabled && m.handle).map(m => {
              const def = PAY_METHODS.find(p => p.key === m.method);
              if (!def) return null;
              return (
                <div key={m.id} style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;background:rgba(255,255,255,0.04);border-radius:8px;border:1px solid var(--rt-border)">
                  <span style="font-size:20px;line-height:1.4">{def.icon}</span>
                  <div style="flex:1">
                    <div style="font-weight:600;font-size:14px;margin-bottom:3px">{def.label}</div>
                    <div style="font-size:13px;color:var(--rt-muted)">{def.instructions(m.handle)}</div>
                  </div>
                  {def.linkTemplate && (
                    <a href={def.linkTemplate(m.handle)} target="_blank" rel="noopener noreferrer" class="rt-btn rt-btn-primary rt-btn-sm" style="white-space:nowrap;text-decoration:none">
                      Pay Now
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {myBills.length > 0 && (
        <div class="rt-card" style="margin-bottom:16px">
          <div class="rt-card-title" style="margin-bottom:14px">🧾 Bills</div>
          <div class="rt-table-wrap">
            <table class="rt-table">
              <thead><tr><th>Bill</th><th>Amount</th><th>Due Date</th><th>Frequency</th><th>Status</th><th>Confirmation #</th><th></th></tr></thead>
              <tbody>
                {myBills.map(b => (
                  <tr key={b.id}>
                    <td style="font-weight:600">{b.name}</td>
                    <td>{fmt(b.amount)}</td>
                    <td>{b.dueDate || "—"}</td>
                    <td style="text-transform:capitalize">{b.frequency}</td>
                    <td><span class={`rt-badge ${b.status==="paid"?"rt-badge-success":b.status==="overdue"?"rt-badge-danger":"rt-badge-warning"}`}>{b.status}</span></td>
                    <td class="text-dim">{b.confirmationNumber || "—"}</td>
                    <td>
                      {b.status !== "paid" && (
                        <button class="rt-btn rt-btn-primary rt-btn-sm" onClick={() => { setBillToMark(b); setConfirmNum(""); }}>Mark Paid</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div class="rt-card">
        <div class="rt-card-title" style="margin-bottom:14px">Payment History</div>
        {myPayments.length===0 ? (
          <div class="rt-empty" style="padding:24px 0"><div class="rt-empty-icon">📄</div><div>No payments recorded yet.</div></div>
        ) : (
          <div class="rt-table-wrap">
            <table class="rt-table">
              <thead><tr><th>Date</th><th>Amount</th><th>Paid Through</th><th>Status</th><th>Note</th></tr></thead>
              <tbody>
                {[...myPayments].sort((a,b)=>b.date.localeCompare(a.date)).map(p => (
                  <tr key={p.id}>
                    <td>{p.date}</td><td style="font-weight:600">{fmt(p.amount)}</td>
                    <td style="color:var(--rt-teal)">{p.paidThrough || "—"}</td>
                    <td><span class={`rt-badge ${p.status==="paid"?"rt-badge-success":p.status==="pending"?"rt-badge-warning":"rt-badge-danger"}`}>{p.status}</span></td>
                    <td class="text-dim">{p.note||"—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ChatCard renter={renter} propertyName={property?.name ?? ""} />
      <div style="margin-top:16px;text-align:center">
        <button class="rt-btn rt-btn-ghost rt-btn-sm" onClick={() => handleRenterChange("")}>← Switch Renter</button>
      </div>
      {showProfile && (
        <ProfileModal renter={renter} onClose={() => setShowProfile(false)} onSaved={() => { reloadRenters(); }} />
      )}
      {billToMark && (
        <Modal title={`Mark as Paid — ${billToMark.name}`} onClose={() => { setBillToMark(null); setConfirmNum(""); }}>
          <div class="rt-form">
            <div class="rt-field">
              <label class="rt-label">Bill</label>
              <div style="padding:8px 0;font-weight:600">{billToMark.name} — {fmt(billToMark.amount)}</div>
            </div>
            <div class="rt-field">
              <label class="rt-label">Confirmation Number</label>
              <input class="rt-input" placeholder="Enter payment confirmation #" value={confirmNum}
                onInput={e => setConfirmNum((e.target as HTMLInputElement).value)}
                onKeyDown={e => { if (e.key === "Enter" && confirmNum.trim()) handleMarkPaid(); }}
              />
              <div style="font-size:12px;color:var(--rt-muted);margin-top:4px">Enter the confirmation number from your payment receipt.</div>
            </div>
            <button class="rt-btn rt-btn-primary w-full mt-2" onClick={handleMarkPaid} disabled={!confirmNum.trim() || markingPaid}>
              {markingPaid ? "Saving..." : "Confirm Payment"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function App() {
  const [mode, setMode] = useState<"admin"|"renter">("renter");
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [renters,,reloadRenters] = useData<Renter>("renters");
  const [properties] = useData<Property>("properties");
  const [payments] = useData<Payment>("payments");
  const [allocations] = useData<Allocation>("allocations");
  const [bills,,reloadBills] = useData<Bill>("bills");
  const [payMethods] = useData<PayMethod>("payMethods");
  const goAdmin = () => { setAdminUnlocked(false); setMode("admin"); };
  const exitAdmin = () => { setAdminUnlocked(false); setMode("renter"); };
  return (
    <div class="rt-shell">
      <div class="rt-header">
        <div class="rt-logo"><div class="rt-logo-badge"><img src="/logo.png" alt="Arnold Ventures" class="rt-logo-img" /></div><div class="rt-logo-text">Properties</div></div>
      </div>
      {mode==="admin"
        ? adminUnlocked ? <AdminPanel onExit={exitAdmin} /> : <AdminAuth onUnlock={() => setAdminUnlocked(true)} />
        : <RenterPortal renters={renters} properties={properties} payments={payments} allocations={allocations} bills={bills} reloadBills={reloadBills} payMethods={payMethods} onAdminLogin={goAdmin} reloadRenters={reloadRenters} />
      }
      <AiChatWidget />
    </div>
  );
}
