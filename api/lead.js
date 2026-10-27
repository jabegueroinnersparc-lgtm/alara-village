// Vercel serverless function: receives the visit form from the page and forwards it
// to your Google Apps Script (Code.gs). The Apps Script URL lives in the Vercel
// environment variable APPS_SCRIPT_URL, so it is never in the page source.
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }
  const url = process.env.APPS_SCRIPT_URL;
  if (!url) {
    res.status(500).json({ ok: false, error: 'not-connected' });
    return;
  }

  let d = req.body;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = {}; } }
  d = d || {};
  const f = function (v) { return String(v == null ? '' : v).slice(0, 300); };
  const payload = {
    id: f(d.id), name: f(d.name), phone: f(d.phone), email: f(d.email),
    model: f(d.model), date: f(d.date), hp: f(d.hp), source: f(d.source)
  };

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    });
    const text = await r.text();
    let out;
    try { out = JSON.parse(text); } catch (e) { out = null; }
    if (!out) { res.status(502).json({ ok: false, error: 'bad-response' }); return; }
    res.status(200).json(out);
  } catch (e) {
    res.status(502).json({ ok: false, error: 'network' });
  }
};

