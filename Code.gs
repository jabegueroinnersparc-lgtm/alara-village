/**
 * Alara Village - Apps Script backend
 * Saves visit requests into the "Leads" sheet, then sends:
 *   1. a branded confirmation email to the lead (their chosen house model + visit date)
 *   2. a notification email to the admin
 *
 * FIRST-TIME SETUP (or after pasting this update):
 *  1. Select  setupDatabase  in the function dropdown and click Run (approve ALL permissions,
 *     this version also needs Gmail sending + Drive access for the house photos).
 *  2. Run  testSave  -> a row appears in the Leads tab and a sample email arrives at the admin address.
 *  3. Deploy > Manage deployments > Edit > Version: New version > Deploy
 *     (Execute as: Me, Who has access: Anyone).
 *
 * Emails are sent from the Google account that owns this script.
 * Gmail limits: about 100 emails/day on a free account (a lead = 2 emails), 1,500/day on Google Workspace.
 */
const SHEET_NAME = 'Leads';
const SPREADSHEET_ID = '';   // optional: paste a Google Sheet ID here. Leave empty to auto-detect or auto-create.
const ADMIN_EMAIL = 'jabeguero.innersparc@gmail.com';   // receives every new lead + gets replies from leads
const BRAND = 'Alara Village';
const CONTACT_PHONE = '+639169994124';            // update to your real sales number
const CONTACT_EMAIL = 'dellosacharlene1317@gmail.com';   // shown in the email footer; update if different
const TIMEZONE = 'Asia/Manila';
const HEADERS = ['Timestamp', 'Name', 'Mobile', 'Email', 'Model', 'Preferred Visit Date', 'Status', 'Source', 'Emails'];
const PROP_KEY = 'LEADS_SPREADSHEET_ID';

/** House model details used in the emails (Drive IDs are the same render images used on the page). */
const MODELS = {
  Raya: {
    img: '1-t2GOukkkvQConSxR5EPSoAc1br_jdMn', tag: 'Where Memories Bloom', area: 110, lot: 121,
    type: '2-Storey Single Attached Home', best: 'Multi-generational households',
    pitch: 'Raya is built for the way Filipino families really live: everyone under one roof, with room to breathe. Its generous shared spaces, dedicated service quarters and exterior-access storage keep daily routines effortless, so the home keeps up with your family as it grows.',
    points: ['Maid\u2019s quarter with its own toilet & bath', 'L-shaped kitchen with a 3-seater bar counter', 'Master\u2019s bedroom with main T&B and a private balcony', 'Lanai, porch, storage and 2-car perpendicular parking']
  },
  Zila: {
    img: '1tHxXHxDG_mpT1LBndq3XRrUWJhkDkw3R', tag: 'Where Families Flourish', area: 96, lot: 121,
    type: '2-Storey Partially Attached Home', best: 'Growing families',
    pitch: 'Zila gives a growing family room to grow into. A bright, open living core sits beside a ground-floor guest room that can welcome relatives, support ageing parents or become the home office you have always wanted. It is a smart, flexible home that adapts as life changes.',
    points: ['Ground-floor guest room with its own T&B', 'L-shaped kitchen with a 2-seater bar counter', 'Master\u2019s bedroom with main T&B and a private balcony', 'Lanai, porch, storage and 2-car parallel parking']
  },
  Veta: {
    img: '1BsCwDRNrOehoL4XYwPvl4sZPdCuNp3PL', tag: 'Where Bonds Blossom', area: 85, lot: 121,
    type: '2-Storey Single Detached Home', best: 'First-time buyers & young couples',
    pitch: 'Veta is the perfect first chapter: an efficient, modern Filipino home that is a single detached house, so it is truly yours. Open living, dining and kitchen spaces make everyday connection easy, while a private master suite and a second bedroom leave room for what comes next.',
    points: ['Single detached two-storey home', 'Open living, dining and L-shaped kitchen', 'Master\u2019s bedroom with T&B and a private balcony', 'Lanai, porch, storage room and 2-car parallel parking']
  },
  Yana: {
    img: '1j05iABCFvItR2kDOvXFkHBGE-HMMJxBu', tag: 'Where Legacies Grow', area: 130, lot: 171,
    type: '2-Storey Single Detached Home', best: 'Legacy buyers & investors',
    pitch: 'Yana is our signature residence and our largest home, made for lasting stories. An expansive gathering level, guest and service spaces and an upstairs family area give larger and multi-generational households comfort for years to come, a home you can hand down.',
    points: ['Upstairs family area for quality time together', 'Ground-floor guest room and maid\u2019s quarter with T&B', 'L-shaped kitchen with a 3-seater bar counter', 'Master\u2019s bedroom with main T&B and balcony, 2-car perpendicular parking']
  }
};

/** Serves the landing page (Index.html). */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Alara Village')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Used when the page is hosted elsewhere (e.g. system.io) and posts to the web app URL. */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    return json_(saveLead(data));
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/** Called from the page with google.script.run.saveLead(data). */
function saveLead(d) {
  if (d && d.hp) return { ok: true };                 // honeypot: silently ignore bots
  const name = clean_(d && d.name);
  const email = clean_(d && d.email);
  const rawPhone = String((d && d.phone) || '').trim();
  if (/[A-Za-z]/.test(rawPhone)) return { ok: false, error: 'Mobile number must contain numbers only.' };
  const phone = cleanPhone_(rawPhone);
  const digits = phone.replace(/\D/g, '');
  if (!name || !phone) return { ok: false, error: 'Name and mobile number are required.' };
  if (digits.length < 10 || digits.length > 13) return { ok: false, error: 'Please enter a valid mobile number (10 to 13 digits).' };
  if (!email) return { ok: false, error: 'Email address is required.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: 'Please enter a valid email address.' };

  const cache = CacheService.getScriptCache();
  const reqId = d && d.id ? 'lead_' + String(d.id).slice(0, 60) : '';
  const lead = { name: name, phone: phone, email: email, model: clean_(d.model), date: clean_(d.date), source: clean_(d.source) };
  let row = 0;

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (reqId && cache.get(reqId)) return { ok: true };   // duplicate submit, already saved
    const sheet = getSheet_();
    sheet.appendRow([new Date(), name, phone, email, lead.model, lead.date, 'New', lead.source, '']);
    row = sheet.getLastRow();
    // Keep the leading 0 / + in the mobile number: if Sheets turned it into a number, store it as text instead.
    try {
      const cell = sheet.getRange(row, 3);
      if (typeof cell.getValue() === 'number') cell.setValue("'" + phone);
    } catch (err) { /* typed column: set its type to Plain text in the sheet */ }
    if (reqId) cache.put(reqId, '1', 600);
  } finally {
    lock.releaseLock();
  }

  // Emails are sent after the lead is safely saved, so an email problem can never lose a lead.
  const status = sendLeadEmails_(lead);
  Logger.log('Email status for row ' + row + ': ' + status);
  writeStatus_(row, status);
  return { ok: true };
}

/* ===================== EMAILS ===================== */

/** Sends the lead confirmation + admin notification. Returns a short status string for the sheet. */
function sendLeadEmails_(lead) {
  const m = MODELS[lead.model] || null;
  const blob = m ? modelImage_(m.img) : null;
  const inline = blob ? { modelimg: blob } : undefined;
  const result = [];

  try {
    const opts = { htmlBody: leadHtml_(lead, m, !!blob), name: BRAND, replyTo: ADMIN_EMAIL };
    if (inline) opts.inlineImages = inline;
    MailApp.sendEmail(lead.email, leadSubject_(lead), leadText_(lead, m), opts);
    result.push('Lead: sent');
  } catch (err) { result.push('Lead: FAILED (' + String(err).slice(0, 80) + ')'); }

  try {
    const opts = { htmlBody: adminHtml_(lead, m, !!blob), name: BRAND + ' Leads', replyTo: lead.email };
    if (inline) opts.inlineImages = inline;
    MailApp.sendEmail(ADMIN_EMAIL, 'New lead: ' + lead.name + ' \u00b7 ' + (lead.model || 'No model') + ' \u00b7 ' + shortDate_(lead.date),
      adminText_(lead), opts);
    result.push('Admin: sent');
  } catch (err) { result.push('Admin: FAILED (' + String(err).slice(0, 80) + ')'); }

  return result.join(' | ');
}

/** Loads the house render for the email. Tries the public thumbnail first (small and fast), then Drive. Returns null if both fail. */
function modelImage_(id) {
  const urls = ['https://drive.google.com/thumbnail?id=' + id + '&sz=w1200', 'https://lh3.googleusercontent.com/d/' + id + '=w1200'];
  for (let i = 0; i < urls.length; i++) {
    try {
      const r = UrlFetchApp.fetch(urls[i], { muteHttpExceptions: true, followRedirects: true });
      const h = r.getHeaders();
      const type = String(h['Content-Type'] || h['content-type'] || '');
      if (r.getResponseCode() === 200 && type.indexOf('image/') === 0) return r.getBlob().setName('house-model.jpg');
    } catch (err) { Logger.log('Image fetch failed: ' + err); }
  }
  try { return DriveApp.getFileById(id).getBlob().setName('house-model.jpg'); }
  catch (err) { Logger.log('Drive read failed for ' + id + ': ' + err); }
  return null;
}

/** Run from the editor to check that all four house images can be loaded for emails. */
function testModelImages() {
  Object.keys(MODELS).forEach(function (k) { Logger.log(k + ': ' + (modelImage_(MODELS[k].img) ? 'OK' : 'NOT LOADED - check sharing of this Drive file')); });
}

function leadSubject_(lead) {
  const first = firstName_(lead.name);
  return lead.model
    ? first + ', your visit to ' + BRAND + ' is noted \u2013 meet the ' + lead.model
    : first + ', thank you for your interest in ' + BRAND;
}

function leadText_(lead, m) {
  return 'Hi ' + firstName_(lead.name) + ',\n\n' +
    'Thank you for requesting a visit to ' + BRAND + '. We have received your request.\n\n' +
    'House model: ' + (lead.model || 'To be discussed') + (m ? ' (' + m.tag + ')' : '') + '\n' +
    'Preferred visit date: ' + prettyDate_(lead.date) + '\n\n' +
    (m ? m.pitch + '\n\n' : '') +
    'Our sales team will contact you shortly on ' + lead.phone + ' to confirm your schedule.\n\n' +
    'Questions? Call ' + CONTACT_PHONE + ' or reply to this email.\n\nWarm regards,\nThe ' + BRAND + ' Team';
}

function leadHtml_(lead, m, hasImg) {
  const first = esc_(firstName_(lead.name));
  const model = esc_(lead.model || 'your chosen home');
  const dateTxt = esc_(prettyDate_(lead.date));
  const gold = '#e0b862', forest = '#0f1f17', moss = '#2c4a3a';

  let modelBlock = '';
  if (m) {
    const pts = m.points.map(function (p) {
      return '<tr><td style="padding:5px 0;vertical-align:top;color:' + gold + ';font-size:14px;width:20px;">&#9670;</td>' +
        '<td style="padding:5px 0;font-size:14.5px;color:#3d4d43;line-height:1.5;">' + esc_(p) + '</td></tr>';
    }).join('');
    modelBlock =
      (hasImg ? '<tr><td style="padding:0;"><img src="cid:modelimg" alt="' + model + ' house model" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;"></td></tr>' : '') +
      '<tr><td style="padding:34px 40px 8px;">' +
        '<div style="font-size:11px;letter-spacing:2.5px;text-transform:uppercase;color:#a07f35;font-weight:700;">Your selected home</div>' +
        '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:36px;line-height:1.1;color:' + forest + ';margin-top:6px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;">' + model + '</div>' +
        '<div style="font-family:Georgia,serif;font-size:20px;font-style:italic;color:#a07f35;margin:4px 0 16px;">' + esc_(m.tag) + '</div>' +
        '<div style="font-size:15.5px;line-height:1.7;color:#3d4d43;">' + esc_(m.pitch) + '</div>' +
      '</td></tr>' +
      '<tr><td style="padding:14px 40px 4px;">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e3e9e1;border-bottom:1px solid #e3e9e1;">' +
          '<tr>' +
            stat_(m.area, 'Floor area (sqm)') + stat_(m.lot, 'Min. lot cut (sqm)') + stat_('2', 'Storeys') + stat_('2', 'Car parking') +
          '</tr>' +
        '</table>' +
      '</td></tr>' +
      '<tr><td style="padding:18px 40px 4px;">' +
        '<div style="font-size:11px;letter-spacing:2.5px;text-transform:uppercase;color:#a07f35;font-weight:700;margin-bottom:6px;">Why you will love it</div>' +
        '<table role="presentation" cellpadding="0" cellspacing="0" width="100%">' + pts + '</table>' +
        '<div style="margin-top:14px;display:inline-block;background:#eef2ec;border-radius:30px;padding:8px 18px;font-size:14px;color:' + moss + ';"><span style="font-size:10.5px;letter-spacing:2px;text-transform:uppercase;color:#a07f35;font-weight:700;">Ideal for&nbsp;&nbsp;</span><b>' + esc_(m.best) + '</b></div>' +
      '</td></tr>';
  }

  return '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#eef2ec;">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your visit request for the ' + model + ' is in. Here is what happens next.</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2ec;padding:28px 12px;"><tr><td align="center">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:6px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#1b2a22;">' +

    // header
    '<tr><td align="center" style="background:' + forest + ';padding:26px 20px;border-bottom:3px solid ' + gold + ';">' +
      '<div style="font-family:Georgia,serif;font-size:22px;letter-spacing:6px;text-transform:uppercase;color:#ffffff;font-weight:bold;">' + BRAND + '</div>' +
      '<div style="font-size:10.5px;letter-spacing:3px;text-transform:uppercase;color:' + gold + ';margin-top:6px;">A place to call home</div>' +
    '</td></tr>' +

    // greeting
    '<tr><td style="padding:38px 40px 10px;">' +
      '<div style="font-family:Georgia,serif;font-size:28px;line-height:1.25;color:' + forest + ';">Hi ' + first + ', we are so glad you are considering ' + BRAND + '.</div>' +
      '<p style="font-size:15.5px;line-height:1.7;color:#3d4d43;margin:16px 0 0;">Thank you for requesting a visit. Your request is confirmed on our side, and one of our sales team members will call you shortly to lock in your schedule. In the meantime, here is a closer look at the home you picked, and why so many families fall in love with it once they step inside.</p>' +
    '</td></tr>' +

    // visit details card
    '<tr><td style="padding:22px 40px 18px;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8f4;border-left:4px solid ' + gold + ';border-radius:4px;">' +
        '<tr><td style="padding:18px 22px;">' +
          '<div style="font-size:11px;letter-spacing:2.5px;text-transform:uppercase;color:#a07f35;font-weight:700;margin-bottom:10px;">Your visit request</div>' +
          '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-size:15px;color:#1b2a22;">' +
            '<tr><td style="padding:4px 0;color:#6a796f;width:150px;">House model</td><td style="padding:4px 0;"><b>' + model + '</b></td></tr>' +
            '<tr><td style="padding:4px 0;color:#6a796f;">Preferred visit date</td><td style="padding:4px 0;"><b>' + dateTxt + '</b></td></tr>' +
            '<tr><td style="padding:4px 0;color:#6a796f;">We will call you on</td><td style="padding:4px 0;"><b>' + esc_(lead.phone) + '</b></td></tr>' +
          '</table>' +
        '</td></tr>' +
      '</table>' +
    '</td></tr>' +

    modelBlock +

    // persuasion
    '<tr><td style="padding:26px 40px 6px;">' +
      '<div style="font-family:Georgia,serif;font-size:24px;line-height:1.3;color:' + forest + ';">Photos only tell part of the story.</div>' +
      '<p style="font-size:15.5px;line-height:1.7;color:#3d4d43;margin:12px 0 0;">The real magic of ' + (lead.model ? 'the ' + model : 'a home at ' + BRAND) + ' is felt in person: standing in the kitchen where your family will gather, stepping onto the lanai with a cup of coffee, and picturing your own mornings here. That is exactly what your visit is for. We would love for you to see it, feel it and imagine yourself home.</p>' +
      '<p style="font-size:15.5px;line-height:1.7;color:#3d4d43;margin:12px 0 0;">The sooner we confirm your visit, the better we can match a time that works for you, and the sooner you can take the first real step toward owning your dream home. Ask our team about the next steps to reserve your home while you are here.</p>' +
    '</td></tr>' +

    // what happens next
    '<tr><td style="padding:22px 40px 6px;">' +
      '<div style="font-size:11px;letter-spacing:2.5px;text-transform:uppercase;color:#a07f35;font-weight:700;margin-bottom:8px;">What happens next</div>' +
      step_('1', 'We confirm your schedule', 'Our team will call or message you shortly to finalize your visit date and time.') +
      step_('2', 'Walk the village with us', 'Tour Alara Village with our sales team and have all your questions answered on site.') +
      step_('3', 'See your home in person', 'View the ' + (lead.model ? model + ' model' : 'model') + ' and its floor plan, and talk through how to make it yours.') +
    '</td></tr>' +

    // CTA
    '<tr><td align="center" style="padding:28px 40px 34px;">' +
      '<a href="mailto:' + esc_(ADMIN_EMAIL) + '?subject=' + encodeURIComponent('My visit to ' + BRAND + (lead.model ? ' - ' + lead.model : '')) + '" style="display:inline-block;background:' + gold + ';color:' + forest + ';text-decoration:none;font-weight:bold;font-size:12px;letter-spacing:2.5px;text-transform:uppercase;padding:16px 34px;border-radius:2px;">Reply to confirm my visit</a>' +
      '<div style="font-size:13.5px;color:#6a796f;margin-top:16px;line-height:1.6;">Prefer to talk? Call us on <b style="color:' + forest + ';">' + esc_(CONTACT_PHONE) + '</b>.</div>' +
    '</td></tr>' +

    // sign-off
    '<tr><td style="padding:0 40px 32px;font-size:15px;line-height:1.7;color:#3d4d43;">Warm regards,<br><b style="color:' + forest + ';">The ' + BRAND + ' Team</b></td></tr>' +

    // footer
    '<tr><td align="center" style="background:' + forest + ';padding:22px 20px;font-size:12px;line-height:1.7;color:#b9c8bd;">' +
      '<b style="color:#ffffff;letter-spacing:3px;text-transform:uppercase;">' + BRAND + '</b><br>' + esc_(CONTACT_PHONE) + ' &nbsp;|&nbsp; ' + esc_(CONTACT_EMAIL) + '<br>' +
      '<span style="color:#8aa58f;">You are receiving this email because you requested a visit on our website. Renders are for illustration; final details are confirmed by our sales team.</span>' +
    '</td></tr>' +

    '</table></td></tr></table></body></html>';
}

function stat_(num, label) {
  return '<td align="center" style="padding:14px 4px;width:25%;">' +
    '<div style="font-family:Georgia,serif;font-size:30px;color:#2c4a3a;line-height:1.1;">' + esc_(num) + '</div>' +
    '<div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#6a796f;line-height:1.3;margin-top:4px;">' + esc_(label) + '</div></td>';
}

function step_(n, title, text) {
  return '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:8px 0;"><tr>' +
    '<td style="width:44px;vertical-align:top;"><div style="width:32px;height:32px;line-height:32px;text-align:center;border-radius:50%;border:1.5px solid #e0b862;color:#a07f35;font-weight:bold;font-size:14px;">' + n + '</div></td>' +
    '<td style="vertical-align:top;"><div style="font-size:15.5px;font-weight:bold;color:#0f1f17;">' + esc_(title) + '</div>' +
    '<div style="font-size:14.5px;line-height:1.6;color:#5b6b61;">' + esc_(text) + '</div></td></tr></table>';
}

/* ---------- admin notification ---------- */

function adminText_(lead) {
  return 'New visit request\n\nName: ' + lead.name + '\nMobile: ' + lead.phone + '\nEmail: ' + lead.email +
    '\nModel: ' + (lead.model || '-') + '\nPreferred visit date: ' + prettyDate_(lead.date) + '\nSource: ' + (lead.source || '-');
}

function adminHtml_(lead, m, hasImg) {
  const gold = '#e0b862', forest = '#0f1f17';
  const first = esc_(firstName_(lead.name));
  const tel = lead.phone.replace(/[^0-9+]/g, '');
  const received = Utilities.formatDate(new Date(), TIMEZONE, "MMM d, yyyy 'at' h:mm a");
  const btn = function (href, label, solid) {
    return '<a href="' + href + '" style="display:block;text-align:center;text-decoration:none;font-weight:bold;font-size:12px;letter-spacing:2px;text-transform:uppercase;padding:15px 10px;border-radius:2px;' +
      (solid ? 'background:' + gold + ';color:' + forest + ';border:1px solid ' + gold + ';' : 'background:#ffffff;color:' + forest + ';border:1px solid ' + forest + ';') + '">' + label + '</a>';
  };
  const row = function (k, v) {
    return '<tr><td style="padding:11px 0;color:#6a796f;width:130px;border-bottom:1px solid #e3e9e1;font-size:14px;">' + k + '</td>' +
      '<td style="padding:11px 0;border-bottom:1px solid #e3e9e1;font-size:15px;color:' + forest + ';"><b>' + v + '</b></td></tr>';
  };
  const hero = hasImg
    ? '<tr><td style="padding:0;"><img src="cid:modelimg" alt="' + esc_(lead.model) + '" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;"></td></tr>'
    : (lead.model
      ? '<tr><td align="center" style="background:#14291f;padding:34px 20px;"><div style="font-family:Georgia,serif;font-size:40px;letter-spacing:4px;text-transform:uppercase;color:#ffffff;">' + esc_(lead.model) + '</div>' +
        (m ? '<div style="font-family:Georgia,serif;font-style:italic;font-size:18px;color:' + gold + ';margin-top:4px;">' + esc_(m.tag) + '</div>' : '') + '</td></tr>'
      : '');
  const box = function (label, value, sub) {
    return '<td width="50%" valign="top" style="padding:0 6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8f4;border-left:4px solid ' + gold + ';border-radius:4px;"><tr><td style="padding:14px 16px;">' +
      '<div style="font-size:10.5px;letter-spacing:2px;text-transform:uppercase;color:#a07f35;font-weight:bold;">' + label + '</div>' +
      '<div style="font-size:16px;font-weight:bold;color:' + forest + ';margin-top:5px;line-height:1.3;">' + value + '</div>' +
      (sub ? '<div style="font-size:12.5px;color:#6a796f;margin-top:2px;">' + sub + '</div>' : '') + '</td></tr></table></td>';
  };

  return '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#eef2ec;">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">' + esc_(lead.name) + ' wants to visit the ' + esc_(lead.model || 'village') + ' on ' + esc_(prettyDate_(lead.date)) + '.</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2ec;padding:28px 12px;"><tr><td align="center">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:6px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#1b2a22;">' +

    // header
    '<tr><td style="background:' + forest + ';padding:20px 30px;border-bottom:3px solid ' + gold + ';">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
        '<td style="font-family:Georgia,serif;font-size:17px;letter-spacing:5px;text-transform:uppercase;color:#ffffff;font-weight:bold;">' + BRAND + '</td>' +
        '<td align="right" style="font-size:10.5px;letter-spacing:2.5px;text-transform:uppercase;color:' + gold + ';font-weight:bold;">New lead</td>' +
      '</tr></table></td></tr>' +

    hero +

    // title
    '<tr><td style="padding:30px 34px 6px;">' +
      '<div style="font-family:Georgia,serif;font-size:27px;line-height:1.25;color:' + forest + ';">' + esc_(lead.name) + ' wants to visit</div>' +
      '<div style="font-size:13px;color:#6a796f;margin-top:6px;">Received ' + esc_(received) + '</div>' +
    '</td></tr>' +

    // summary boxes
    '<tr><td style="padding:18px 28px 6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
      box('Preferred visit', esc_(prettyDate_(lead.date))) +
      box('House model', esc_(lead.model || 'Not selected'), m ? esc_(m.area + ' sqm \u00b7 ' + m.best) : '') +
    '</tr></table></td></tr>' +

    // contact details
    '<tr><td style="padding:14px 34px 4px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
      row('Mobile', '<a href="tel:' + esc_(tel) + '" style="color:' + forest + ';text-decoration:none;">' + esc_(lead.phone) + '</a>') +
      row('Email', '<a href="mailto:' + esc_(lead.email) + '" style="color:' + forest + ';text-decoration:none;">' + esc_(lead.email) + '</a>') +
      row('Submitted from', sourceCell_(lead.source)) +
    '</table></td></tr>' +

    // action buttons
    '<tr><td style="padding:24px 28px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
      '<td width="50%" style="padding:0 6px;">' + btn('tel:' + esc_(tel), 'Call ' + first, true) + '</td>' +
      '<td width="50%" style="padding:0 6px;">' + btn('mailto:' + esc_(lead.email) + '?subject=' + encodeURIComponent('Your visit to ' + BRAND), 'Email ' + first, false) + '</td>' +
    '</tr></table></td></tr>' +

    // note
    '<tr><td style="padding:16px 34px 30px;font-size:13px;line-height:1.6;color:#6a796f;">' +
      '\u2713 A confirmation email with the ' + esc_(lead.model || 'house model') + ' details was already sent to ' + first + '. ' +
      'A quick follow-up call is the best way to lock in the visit.' +
    '</td></tr>' +

    // footer
    '<tr><td align="center" style="background:' + forest + ';padding:16px 20px;font-size:11.5px;color:#8aa58f;">Saved to your <b style="color:#ffffff;">Leads</b> sheet &nbsp;\u00b7&nbsp; ' + BRAND + ' lead alert</td></tr>' +

    '</table></td></tr></table></body></html>';
}

/** Short readable label for the page URL: campaign if the link has utm tags, otherwise host + path. */
function sourceLabel_(url) {
  url = String(url || '');
  if (!url) return 'Not recorded';
  if (/googleusercontent\.com|script\.google\.com/i.test(url)) return 'Website (Apps Script page)';
  const m = url.match(/^https?:\/\/([^\/?#]+)([^?#]*)/i);
  let label = m ? m[1].replace(/^www\./, '') + (m[2] && m[2] !== '/' ? m[2] : '') : 'Website';
  const utm = url.match(/[?&]utm_source=([^&#]+)/i);
  const camp = url.match(/[?&]utm_campaign=([^&#]+)/i);
  if (utm) {
    try { label += ' (via ' + decodeURIComponent(utm[1]) + (camp ? ' / ' + decodeURIComponent(camp[1]) : '') + ')'; } catch (e) { label += ' (via ' + utm[1] + ')'; }
  }
  return label;
}

/** Table cell content: the readable label, linked to the full page URL when it is a normal web address. */
function sourceCell_(url) {
  url = String(url || '');
  const label = esc_(sourceLabel_(url));
  if (/^https?:\/\//i.test(url) && !/googleusercontent\.com|script\.google\.com/i.test(url)) {
    return '<a href="' + esc_(url) + '" style="color:#0f1f17;text-decoration:underline;word-break:break-all;">' + label + '</a>';
  }
  return label;
}

function shortDate_(s) {
  if (!s) return 'date TBC';
  try { return Utilities.formatDate(Utilities.parseDate(String(s), TIMEZONE, 'yyyy-MM-dd'), TIMEZONE, 'EEE, MMM d'); }
  catch (err) { return String(s); }
}

/* ===================== SHEET HELPERS ===================== */

/** RUN THIS ONCE from the editor. Creates the sheet, headers, and authorizes the script. */
function setupDatabase() {
  const ss = getSpreadsheet_();
  const sh = getSheet_();
  DriveApp.getRootFolder();   // triggers the Drive permission prompt
  Logger.log('Database ready: ' + ss.getUrl() + ' (tab: ' + sh.getName() + ')');
  return ss.getUrl();
}

/** Finds the spreadsheet: manual ID > bound sheet > saved ID > creates a new one. */
function getSpreadsheet_() {
  if (SPREADSHEET_ID) return SpreadsheetApp.openById(SPREADSHEET_ID);

  const active = SpreadsheetApp.getActiveSpreadsheet();   // works if script was made from inside a Sheet
  if (active) return active;

  const props = PropertiesService.getScriptProperties();  // standalone script
  const savedId = props.getProperty(PROP_KEY);
  if (savedId) {
    try { return SpreadsheetApp.openById(savedId); } catch (e) { /* deleted, create a new one */ }
  }
  const created = SpreadsheetApp.create('Alara Village Leads');
  props.setProperty(PROP_KEY, created.getId());
  return created;
}

/** Gets the Leads sheet, creating it with a styled header row if missing. */
function getSheet_() {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    const first = ss.getSheets()[0];
    if (first.getName() !== SHEET_NAME && first.getLastRow() === 0) ss.deleteSheet(first); // remove empty "Sheet1"
  }
  if (sh.getMaxColumns() < HEADERS.length) sh.insertColumnsAfter(sh.getMaxColumns(), HEADERS.length - sh.getMaxColumns());
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
      .setFontWeight('bold').setBackground('#14291f').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm');
    try { sh.getRange('C:C').setNumberFormat('@'); } catch (err) { /* typed column, ignore */ }
    sh.setColumnWidths(1, HEADERS.length, 150);
  } else if (!sh.getRange(1, 9).getValue()) {
    // existing sheet from the older version: add the new "Emails" column header
    sh.getRange(1, 9).setValue('Emails').setFontWeight('bold').setBackground('#14291f').setFontColor('#ffffff');
    sh.setColumnWidth(9, 220);
  }
  return sh;
}

/** Writes the email result ("Lead: sent | Admin: sent") into the Emails column of the lead's row. */
function writeStatus_(row, status) {
  if (!row) { Logger.log('writeStatus_: no row number, status not written'); return; }
  try {
    const sh = getSheet_();
    sh.getRange(row, 9).setNumberFormat('@').setValue(status);
    SpreadsheetApp.flush();
  } catch (err) {
    Logger.log('Could not write email status to the sheet: ' + err);
  }
}

/* ===================== UTILITIES ===================== */

/** Trims text and blocks spreadsheet formula injection (=, +, -, @). */
function clean_(v) {
  v = String(v == null ? '' : v).trim().slice(0, 300);
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

/** Phone numbers: keep only digits, + ( ) - and spaces. Safe from formula injection. */
function cleanPhone_(v) {
  return String(v == null ? '' : v).replace(/[^0-9+()\-\s]/g, '').trim().slice(0, 30);
}

/** Escapes text before putting it in an HTML email. */
function esc_(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function firstName_(name) {
  return String(name || 'there').replace(/^'/, '').trim().split(/\s+/)[0] || 'there';
}

/** '2026-11-01' -> 'Sunday, November 1, 2026'. Blank -> a friendly fallback. */
function prettyDate_(s) {
  if (!s) return 'To be confirmed with our team';
  try { return Utilities.formatDate(Utilities.parseDate(String(s), TIMEZONE, 'yyyy-MM-dd'), TIMEZONE, 'EEEE, MMMM d, yyyy'); }
  catch (err) { return String(s); }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor: saves a test lead and sends both emails (the "lead" copy goes to the admin address too). */
function testSave() {
  Logger.log(saveLead({
    id: 'test-' + Date.now(), name: 'Test Lead', phone: '09000000000', email: ADMIN_EMAIL,
    model: 'Raya', date: Utilities.formatDate(new Date(Date.now() + 7 * 864e5), TIMEZONE, 'yyyy-MM-dd'), source: 'testSave'
  }));
}
