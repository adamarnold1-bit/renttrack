import { useState, useEffect } from "preact/hooks";

const BASE = "/api/rent-tracker";
const API = (entity: string, extra = "") => `${BASE}?entity=${entity}${extra}`;

const fmt = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COLORS = ["#00c9a7","#f59e0b","#818cf8","#f43f5e","#34d399","#60a5fa","#fb923c","#e879f9"];

type Property = { id: string; name: string; address: string; units: number };
type Renter = { id: string; name: string; email: string; propertyId: string; unit: string; rentAmount: number; dueDay: number; pin?: string };
type Payment = { id: string; renterId: string; amount: number; date: string; status: "paid"|"pending"|"late"; note: string };
type Allocation = { id: string; label: string; pct: number; color: string };
type Bill = { id: string; name: string; propertyId: string; amount: number; dueDate: string; frequency: string; status: "paid"|"pending"|"overdue"; notes: string };

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
  const [form, setForm] = useState({ name: "", email: "", propertyId: "", unit: "", rentAmount: "", dueDay: "1", pin: "" });
  const save = async () => {
    if (!form.name || !form.propertyId || !form.rentAmount) { toast("Name, property, and rent required", "error"); return; }
    if (form.pin && (form.pin.length !== 4 || !/^\d{4}$/.test(form.pin))) { toast("PIN must be exactly 4 digits", "error"); return; }
    await post("renters", { ...form, rentAmount: parseFloat(form.rentAmount), dueDay: parseInt(form.dueDay), pin: form.pin || null });
    toast("Renter added"); setModal(false); setForm({ name: "", email: "", propertyId: "", unit: "", rentAmount: "", dueDay: "1", pin: "" }); reload();
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
            <thead><tr><th>Name</th><th>Property</th><th>Unit</th><th>Rent</th><th>Due</th><th>PIN</th><th></th></tr></thead>
            <tbody>
              {renters.map(r => (
                <tr key={r.id}>
                  <td>{r.name}</td><td>{propName(r.propertyId)}</td><td>{r.unit||"—"}</td>
                  <td style="color:var(--rt-teal);font-weight:600">{fmt(r.rentAmount)}</td>
                  <td>Day {r.dueDay}</td>
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
              <div class="rt-field"><label class="rt-label">Due Day</label><input class="rt-input" type="number" inputMode="numeric" value={form.dueDay} min="1" max="31" onInput={e => setForm(f => ({ ...f, dueDay: (e.target as HTMLInputElement).value }))} /></div>
            </div>
            <div class="rt-field"><label class="rt-label">Monthly Rent</label><input class="rt-input" type="number" inputMode="decimal" value={form.rentAmount} onInput={e => setForm(f => ({ ...f, rentAmount: (e.target as HTMLInputElement).value }))} placeholder="1200.00" /></div>
            <div class="rt-field"><label class="rt-label">4-Digit Portal PIN</label><input class="rt-input" type="password" inputMode="numeric" maxLength={4} value={form.pin} onInput={e => setForm(f => ({ ...f, pin: (e.target as HTMLInputElement).value }))} placeholder="••••" /></div>
            <button class="rt-btn rt-btn-primary w-full mt-2" onClick={save}>Save Renter</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function PaymentsTab({ payments, renters, reload }: { payments: Payment[]; renters: Renter[]; reload: () => void }) {
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ renterId: "", amount: "", date: new Date().toISOString().slice(0,10), status: "paid", note: "" });
  const save = async () => {
    if (!form.renterId || !form.amount) { toast("Renter and amount required", "error"); return; }
    await post("payments", { ...form, amount: parseFloat(form.amount) });
    toast("Payment logged"); setModal(false); setForm({ renterId: "", amount: "", date: new Date().toISOString().slice(0,10), status: "paid", note: "" }); reload();
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
            <thead><tr><th>Date</th><th>Renter</th><th>Amount</th><th>Status</th><th>Note</th></tr></thead>
            <tbody>
              {[...payments].sort((a,b) => b.date.localeCompare(a.date)).map(p => (
                <tr key={p.id}>
                  <td>{p.date}</td><td>{renterName(p.renterId)}</td>
                  <td style="font-weight:600">{fmt(p.amount)}</td>
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
              <select class="rt-select" value={form.renterId} onChange={e => { const id=(e.target as HTMLSelectElement).value; const r=renters.find(x=>x.id===id); setForm(f=>({...f,renterId:id,amount:r?String(r.rentAmount):f.amount})); }}>
                <option value="">Select renter...</option>
                {renters.map(r => <option value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div class="rt-form-row">
              <div class="rt-field"><label class="rt-label">Amount</label><input class="rt-input" type="number" inputMode="decimal" value={form.amount} onInput={e => setForm(f=>({...f,amount:(e.target as HTMLInputElement).value}))} /></div>
              <div class="rt-field"><label class="rt-label">Date</label><input class="rt-input" type="date" value={form.date} onInput={e => setForm(f=>({...f,date:(e.target as HTMLInputElement).value}))} /></div>
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

function AdminPanel() {
  const [properties,,reloadProps] = useData<Property>("properties");
  const [renters,,reloadRenters] = useData<Renter>("renters");
  const [payments,,reloadPayments] = useData<Payment>("payments");
  const [allocations,,reloadAllocs] = useData<Allocation>("allocations");
  const [bills,,reloadBills] = useData<Bill>("bills");
  const [tab, setTab] = useState("properties");
  return (
    <div>
      <div class="rt-tabs">
        {[["properties","🏘️ Properties"],["renters","👤 Renters"],["payments","💳 Payments"],["allocations","🥧 Allocations"],["bills","🧾 Bills"]].map(([id,label]) => (
          <button key={id} class={`rt-tab${tab===id?" active":""}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab==="properties" && <PropertiesTab properties={properties} reload={reloadProps} />}
      {tab==="renters" && <RentersTab renters={renters} properties={properties} reload={reloadRenters} />}
      {tab==="payments" && <PaymentsTab payments={payments} renters={renters} reload={reloadPayments} />}
      {tab==="allocations" && <AllocationsTab allocations={allocations} reload={reloadAllocs} />}
      {tab==="bills" && <BillsTab bills={bills} properties={properties} reload={reloadBills} />}
    </div>
  );
}

function RenterPortal({ renters, properties, payments, allocations }: { renters: Renter[]; properties: Property[]; payments: Payment[]; allocations: Allocation[] }) {
  const [renterId, setRenterId] = useState("");
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const selectedRenter = renters.find(r => r.id === renterId);
  const handlePinSubmit = () => {
    if (!selectedRenter) return;
    if (pinInput === String(selectedRenter.pin)) { setUnlocked(true); setPinError(false); }
    else { setPinError(true); setPinInput(""); toast("Incorrect PIN", "error"); }
  };
  const handleRenterChange = (id: string) => { setRenterId(id); setPinInput(""); setPinError(false); setUnlocked(false); };
  const renter = unlocked ? selectedRenter : undefined;
  const property = renter ? properties.find(p => p.id === renter.propertyId) : null;
  const myPayments = payments.filter(p => p.renterId === renterId);
  const paid = myPayments.filter(p => p.status==="paid").reduce((s,p) => s+p.amount, 0);
  const allTotal = allocations.reduce((s,a) => s+a.pct, 0);

  if (!renterId || !renter) {
    return (
      <div class="rt-portal">
        <div class="rt-login">
          <div class="rt-login-title">Renter Portal</div>
          <div class="rt-login-sub">Select your name and enter your 4-digit PIN to view your details.</div>
          <div class="rt-form">
            <div class="rt-field">
              <label class="rt-label">Your Name</label>
              <select class="rt-select" value={renterId} onChange={e => handleRenterChange((e.target as HTMLSelectElement).value)}>
                <option value="">Choose renter...</option>
                {renters.map(r => <option value={r.id}>{r.name}</option>)}
              </select>
            </div>
            {renterId && !unlocked && (
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
        </div>
      </div>
    );
  }

  return (
    <div class="rt-portal">
      <div class="rt-portal-hero">
        <div class="rt-portal-name">👋 Hi, {renter.name}</div>
        <div class="rt-portal-prop">{property?.name ?? "—"}{renter.unit ? ` · Unit ${renter.unit}` : ""}</div>
        <div class="rt-portal-amount">{fmt(renter.rentAmount)}</div>
        <div class="rt-portal-due">Monthly rent · Due on the {renter.dueDay}{renter.dueDay===1?"st":renter.dueDay===2?"nd":renter.dueDay===3?"rd":"th"}</div>
        <div style="margin-top:16px;display:flex;gap:16px;justify-content:center;flex-wrap:wrap">
          <div class="rt-stat" style="flex:1;min-width:120px"><div class="rt-stat-label">Total Paid</div><div class="rt-stat-value teal" style="font-size:18px">{fmt(paid)}</div></div>
          <div class="rt-stat" style="flex:1;min-width:120px"><div class="rt-stat-label">Payments</div><div class="rt-stat-value" style="font-size:18px">{myPayments.length}</div></div>
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
                  <span class="rt-alloc-amt">{fmt(renter.rentAmount * a.pct / 100)}/mo</span>
                </div>
              </div>
            ))}
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
              <thead><tr><th>Date</th><th>Amount</th><th>Status</th><th>Note</th></tr></thead>
              <tbody>
                {[...myPayments].sort((a,b)=>b.date.localeCompare(a.date)).map(p => (
                  <tr key={p.id}>
                    <td>{p.date}</td><td style="font-weight:600">{fmt(p.amount)}</td>
                    <td><span class={`rt-badge ${p.status==="paid"?"rt-badge-success":p.status==="pending"?"rt-badge-warning":"rt-badge-danger"}`}>{p.status}</span></td>
                    <td class="text-dim">{p.note||"—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div style="margin-top:16px;text-align:center">
        <button class="rt-btn rt-btn-ghost rt-btn-sm" onClick={() => handleRenterChange("")}>← Switch Renter</button>
      </div>
    </div>
  );
}

export function App() {
  const [mode, setMode] = useState<"admin"|"renter">("admin");
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [renters] = useData<Renter>("renters");
  const [properties] = useData<Property>("properties");
  const [payments] = useData<Payment>("payments");
  const [allocations] = useData<Allocation>("allocations");
  const handleModeSwitch = (m: "admin"|"renter") => { if (m==="admin") setAdminUnlocked(false); setMode(m); };
  return (
    <div class="rt-shell">
      <div class="rt-header">
        <div class="rt-logo"><div class="rt-logo-icon">🏠</div><div class="rt-logo-text">Rent<span>Track</span></div></div>
        <div class="rt-mode-toggle">
          <button class={`rt-mode-btn${mode==="admin"?" active":""}`} onClick={() => handleModeSwitch("admin")}>Admin</button>
          <button class={`rt-mode-btn${mode==="renter"?" active":""}`} onClick={() => handleModeSwitch("renter")}>Renter</button>
        </div>
      </div>
      {mode==="admin"
        ? adminUnlocked ? <AdminPanel /> : <AdminAuth onUnlock={() => setAdminUnlocked(true)} />
        : <RenterPortal renters={renters} properties={properties} payments={payments} allocations={allocations} />
      }
    </div>
  );
}
