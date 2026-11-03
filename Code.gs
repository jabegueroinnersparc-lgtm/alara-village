/**
 * Alara Village: Lead capture + PREMIUM 30-day Cold/Warm/Hot email nurture (Google Apps Script)
 *
 *  1. Nagse-serve ng landing page (Index.html) bilang web app
 *  2. Sine-save ang bawat lead sa Google Sheet (tab: "Alara Leads")
 *  3. Nagpapadala ng notification kay Joey at premium confirmation sa buyer (Email 1)
 *  4. Araw-araw na trigger na nagpapadala ng Email 2 hanggang 30 (isa kada araw, bilang ng kalendaryo) (30-day sequence)
 *  5. Unsubscribe link sa bawat marketing email
 *  6. Mobile + desktop responsive ang lahat ng emails
 *
 * Gamitin bilang CONTAINER-BOUND script: buksan ang Google Sheet > Extensions > Apps Script.
 */

const CONFIG = {
  NOTIFY_EMAIL: 'joeyryambao@gmail.com',
  AGENT_NAME: 'Joey Yambao',
  BRAND: 'Hanap Bahay Advisor',
  AGENT_PHONE: '0917 168 0560',
  AGENT_EMAIL: 'joeyryambao@gmail.com',
  FACEBOOK_URL: 'https://www.facebook.com/MyNAMEisWESLEY?rdid=HySqX4uMMGvLh8zR&share_url=https%3A%2F%2Fwww.facebook.com%2Fshare%2F1ACgz51a7o#',
  TEST_EMAIL: 'karl.innersparc@gmail.com', // testSubmit() at previewAllEmails() lang; production uses the lead email from the form
  PAGE_URL: '',                 // optional: public URL ng landing page; kung blanko, walang "balik sa page" link sa emails
  WEB_APP_URL: '',              // IMPORTANT: i-paste dito ang Web App URL na nagtatapos sa /exec (para gumana ang unsubscribe link)
  // Image sa emails (nasa FOOTER na, hindi na sa header). Galing sa Google Drive file (ID mula sa share link). Iembed ito bilang inline image,
  // kaya lalabas kahit hindi naka-public ang file. Iwanang '' para walang image.
  EMAIL_IMAGE_FILE_ID: '1f0k1rfbmmzFB50gNTrxRMPgbbZEtOwk6',
  EMAIL_IMAGE_ALT: 'Alara Village',
  EMAIL_IMAGE_WIDTH: 'full', // 'full' = sagad sa lapad ng green footer (may margin sa gilid). O maglagay ng number sa px (hal. 260, 400) para mas maliit at naka-center. Auto ang taas.
  EMAIL_IMAGE_EMAILS: [0, 9, 19, 29], // anong emails ang may image (0 = Email 1). Mas kaunti = mas mabilis mag-load sa mobile data
  // PDF na naka-attach sa bawat nurture email. Kailangan may access ang script account sa Drive file.
  COMPUTATION_PDF_FILE_ID: '1Abv7ZQpwxww0Z5cwJSVRNJdH31YMt32R',
  COMPUTATION_PDF_NAME: 'Alara Village House Model Computations.pdf',
  SHEET_NAME: 'Alara Leads', // BAGONG plain tab (walang Table). Ang lumang 'Leads' tab ay hindi na gagamitin ng form.
  // Required only when this is a standalone script. Paste the spreadsheet ID from its URL.
  SPREADSHEET_ID: '',
  // 30-day sequence: ISANG email kada araw (Day 1 = agad). COLD Day 1-10 | WARM Day 11-20 | HOT Day 21-30
  SEQUENCE_DAYS: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29],
  SEND_HOUR: 9,                   // oras (Asia/Manila) ng daily trigger
  // Hihinto ang sequence sa mga status na ito. Kapag nakausap mo na ang lead nang personal, ilipat ang status para hindi na siya maka-receive ng automated emails.
  STOP_STATUSES: ['Consultation Scheduled', 'Site Visit Completed', 'Reserved', 'Not Proceeding']
};

var BUILD_ = 'v7-daily-quota';
var STEP_ = '';

const STATUSES = ['New Inquiry', 'Contact Attempted', 'Contacted', 'Qualified', 'Consultation Scheduled',
  'Site Visit Requested', 'Site Visit Completed', 'Follow-up', 'Reserved', 'Not Proceeding'];

const HEADERS = ['Submitted At', 'Lead ID', 'Name', 'Email', 'Mobile', 'Monthly Budget', 'Availability', 'Project / Budget Idea',
  'Buyer Type', 'Main Question', 'Location', 'Request Type', 'Consent', 'Consent Text', 'Source',
  'Status', 'Next Action', 'Emails Sent', 'Last Email At', 'Unsubscribed', 'Unsub Token', 'Notes',
  // New consultation fields are appended to preserve existing Leads column positions.
  'Main Reason', 'Property Type', 'Preferred Location', 'Monthly Down Payment', 'Financing Plan', 'Biggest Concern', 'Other Concern'];

const COL = {}; HEADERS.forEach(function (h, i) { COL[h] = i; });

/* ---------------------------------------------------------------- web app */

function doGet(e) {
  if (e && e.parameter && e.parameter.unsub) {
    return unsubscribePage_(e.parameter.unsub);
  }
  try {
    return HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('Alara Village | Hanap Bahay Advisor')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    // Walang Index.html sa project (naka-host ang page sa ibang lugar). Health check na lang.
    return ContentService.createTextOutput('Alara Village lead API is running.').setMimeType(ContentService.MimeType.TEXT);
  }
}

/** Para sa page na naka-host sa ibang lugar. Ang fetch ay dapat gumamit ng Content-Type: text/plain para iwas CORS preflight. */
function doPost(e) {
  var out;
  try {
    var data;
    if (e && e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    } else if (e && e.parameter) {
      data = e.parameter; // fallback kung form-encoded ang pagkakapadala
    } else {
      throw new Error('Empty request body.');
    }
    out = submitLead(data);
  } catch (err) {
    console.error('doPost failed: ' + err + (err && err.stack ? '\n' + err.stack : ''));
    out = { ok: false, error: 'Server error: ' + (err && err.message ? err.message : err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** Tinatawag ng page gamit ang google.script.run.submitLead(data) */
function submitLead(data) {
  try {
    return submitLeadCore_(data);
  } catch (err) {
    console.error('submitLead failed: ' + err + (err && err.stack ? '\n' + err.stack : ''));
    return { ok: false, error: '[' + BUILD_ + ' | step: ' + STEP_ + '] ' + String(err && err.message ? err.message : err) };
  }
}

function submitLeadCore_(data) {
  var v = validate_(data);
  if (v) { console.warn('Validation failed: ' + v); return { ok: false, error: v }; }
  data.question = String(data.question == null ? '' : data.question);

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var row, sheet, rowNum;
  try {
    STEP_ = 'getSheet_';
    sheet = getSheet_();
    STEP_ = 'build-row';
    var id = 'AV-' + Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyyMMdd') + '-' + Utilities.getUuid().slice(0, 6).toUpperCase();
    var token = Utilities.getUuid();
    row = [
      new Date(), id, clean_(data.fullName, 120), clean_(data.email, 160).toLowerCase(), clean_(data.mobile, 40),
      clean_(data.monthly, 60), clean_(data.availability, 120), clean_(data.question && data.question.slice(0,120), 120), clean_(data.buyerType, 80),
      clean_(data.question, 1000), clean_(data.location, 120), clean_(data.requestType, 60),
      'YES', clean_(data.consentText, 600), clean_(data.source, 80) || 'alara-village-landing',
      'New Inquiry', 'Contact lead within 1 business day', 0, '', '', token, '',
      clean_(data.mainReason, 100), clean_(data.propertyType, 100), clean_(data.preferredLocation, 100),
      clean_(data.monthlyDownPayment, 100), clean_(data.financingPlan, 100), clean_(data.biggestConcern, 100), clean_(data.concernOther, 160)
    ];
    // FIX: gawing plain text ang Mobile column para hindi mawala ang leading 0 (09171234567)
    STEP_ = 'appendLeadRow_';
    rowNum = appendLeadRow_(sheet, row); // FIX: gumagana kahit may Table / typed columns ang sheet
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  // Ang lead ay naka-save na. Ang email errors ay hindi dapat magpa-fail ng submission.
  STEP_ = 'notifyAgent_';
  try { notifyAgent_(row); } catch (err) { appendNote_(sheet, rowNum, 'Agent notification failed: ' + err); }
  STEP_ = 'sendSequenceEmail_';
  try { sendSequenceEmail_(sheet, rowNum, 0); } catch (err) { appendNote_(sheet, rowNum, 'Email 1 failed: ' + err); }
  return { ok: true };
}

/* ------------------------------------------------------------- validation */

function validate_(d) {
  if (!d || typeof d !== 'object') return 'Invalid request.';
  var name = String(d.fullName || '').trim();
  var email = String(d.email || '').trim();
  var mobile = String(d.mobile || '').replace(/[\s\-().]/g, '');
  if (name.length < 2) return 'Please enter your full name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return 'Please enter a valid email address.';
  if (!(/^(\+?63|0)9\d{9}$/.test(mobile) || /^\+?\d{9,15}$/.test(mobile))) return 'Please enter a valid mobile number.';
  var consent = d.consentToContact;
  if (!(consent === true || /^(true|yes|on|1)$/i.test(String(consent)))) return 'Consent is required.';
  return '';
}

function clean_(v, max) {
  var s = String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
  // iwas spreadsheet formula injection
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

/* ------------------------------------------------------------------ sheet */

function getSpreadsheet_() {
  var configuredId = String(CONFIG.SPREADSHEET_ID || PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '').trim();
  if (configuredId) return SpreadsheetApp.openById(configuredId);
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  throw new Error('No spreadsheet is connected. Add the spreadsheet ID to CONFIG.SPREADSHEET_ID, or open this script from Google Sheets via Extensions > Apps Script.');
}

function getSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold').setBackground('#2E4D3E').setFontColor('#FFFFFF');
    sheet.setFrozenRows(1);
  } else {
    var existingHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
    var missingHeaders = HEADERS.filter(function (h) { return existingHeaders.indexOf(h) === -1; });
    if (missingHeaders.length) {
      // FIX: ddagdagan muna ang columns kung kulang, para hindi mag-error ang "range outside the dimensions of the sheet"
      var neededCols = existingHeaders.length + missingHeaders.length;
      if (sheet.getMaxColumns() < neededCols) sheet.insertColumnsAfter(sheet.getMaxColumns(), neededCols - sheet.getMaxColumns());
      sheet.getRange(1, existingHeaders.length + 1, 1, missingHeaders.length).setValues([missingHeaders]).setFontWeight('bold').setBackground('#2E4D3E').setFontColor('#FFFFFF');
    }
  }
  applyStatusDropdown_(sheet); // FIX: hindi na magki-crash kahit "typed column" (Table) ang Status
  return sheet;
}

function appendNote_(sheet, rowNum, text) {
  try {
    var cell = sheet.getRange(rowNum, COL['Notes'] + 1);
    var old = cell.getValue();
    cell.setValue((old ? old + ' | ' : '') + Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyy-MM-dd HH:mm') + ' ' + text);
  } catch (err) {
    Logger.log('appendNote_ skipped: ' + err.message + ' | note was: ' + text);
  }
}

/* ------------------------------------------------------- agent notification */

function notifyAgent_(r) {
  var name = r[COL['Name']];
  var rows = [
    ['Name', name], ['Email', r[COL['Email']]], ['Mobile', r[COL['Mobile']]],
    ['Budget range', r[COL['Monthly Budget']] || '(not given)'], ['Availability', r[COL['Availability']] || '(not given)'],
    ['Property interest', r[COL['Project / Budget Idea']] || '(not given)'], ['Buyer Type', r[COL['Buyer Type']] || '(not given)'],
    ['Main reason', r[COL['Main Reason']] || '(not given)'], ['Property type', r[COL['Property Type']] || '(not given)'],
    ['Preferred location', r[COL['Preferred Location']] || '(not given)'], ['Monthly down payment', r[COL['Monthly Down Payment']] || '(not given)'],
    ['Financing plan', r[COL['Financing Plan']] || '(not given)'], ['Biggest concern', r[COL['Biggest Concern']] || '(not given)'],
    ['Other concern', r[COL['Other Concern']] || '(none)'], ['Current location', r[COL['Location']] || '(not given)'],
    ['Request type', r[COL['Request Type']]], ['Main question', r[COL['Main Question']] || '(none)'],
    ['Consent status', 'Consented to be contacted: YES'],
    ['Submission date', Utilities.formatDate(r[COL['Submitted At']], 'Asia/Manila', 'yyyy-MM-dd HH:mm') + ' (Asia/Manila)'],
    ['Source campaign', r[COL['Source']]], ['Lead ID', r[COL['Lead ID']]]
  ];
  var html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#14213D"><h2 style="color:#0B3D91">New Alara Village lead</h2><table cellpadding="6" style="border-collapse:collapse">' +
    rows.map(function (x) { return '<tr><td style="border-bottom:1px solid #CBD5E1"><b>' + esc_(x[0]) + '</b></td><td style="border-bottom:1px solid #CBD5E1">' + esc_(x[1]) + '</td></tr>'; }).join('') +
    '</table><p>Open the sheet to update the status and next action.</p></div>';
  var text = rows.map(function (x) { return x[0] + ': ' + x[1]; }).join('\n');
  MailApp.sendEmail({
    to: CONFIG.NOTIFY_EMAIL,
    subject: 'Bagong Alara Village inquiry — ' + name,
    body: text, htmlBody: html,
    replyTo: r[COL['Email']], name: 'Alara Village Leads'
  });
}

/* ------------------------------------------------------------- email sequence */

/** Bilang ng araw sa kalendaryo (Asia/Manila, UTC+8). Para ang "Araw 2" ay dumating kinabukasan, anuman ang oras ng pag-submit. */
function dayNumber_(d) {
  return Math.floor((new Date(d).getTime() + 8 * 3600000) / 86400000);
}

/**
 * Hinahanap ang mga lead na may email na dapat ipadala ngayon (isa kada lead kada araw).
 * Ibinabalik: { due: [{rowNum, sent, submitted}], active: bilang ng leads na nasa sequence pa }
 * Mas inuuna ang mga bagong lead (kaunti pa lang ang natatanggap) kung kulang ang quota.
 */
function getDueList_(sheet, now) {
  var out = { due: [], active: 0 };
  var last = sheet.getLastRow();
  if (last < 2) return out;
  now = now || new Date();
  var today = dayNumber_(now);
  var values = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    var sent = Number(r[COL['Emails Sent']]) || 0;
    if (sent >= CONFIG.SEQUENCE_DAYS.length) continue;
    if (r[COL['Consent']] !== 'YES') continue;
    if (r[COL['Unsubscribed']]) continue;
    if (CONFIG.STOP_STATUSES.indexOf(r[COL['Status']]) !== -1) continue;
    var submitted = new Date(r[COL['Submitted At']]);
    if (isNaN(submitted.getTime())) continue;
    out.active++;
    var ageDays = today - dayNumber_(submitted);
    if (ageDays < CONFIG.SEQUENCE_DAYS[sent]) continue;
    out.due.push({ rowNum: i + 2, sent: sent, submitted: submitted.getTime() });
  }
  out.due.sort(function (x, y) { return x.sent - y.sent || x.submitted - y.submitted; });
  return out;
}

/** Daily trigger: nagpapadala ng susunod na email (isa kada araw) sa bawat lead na dumating na ang araw. */
function sendDueEmails() {
  var sheet = getSheet_();
  var info = getDueList_(sheet);
  var sentCount = 0, failed = 0, skipped = 0;
  for (var k = 0; k < info.due.length; k++) {
    var d = info.due[k];
    if (MailApp.getRemainingDailyQuota() < 3) { skipped = info.due.length - k; break; } // may reserba para sa notification ng bagong leads
    try {
      sendSequenceEmail_(sheet, d.rowNum, d.sent);
      sentCount++;
    } catch (err) {
      failed++;
      appendNote_(sheet, d.rowNum, 'Email ' + (d.sent + 1) + ' failed: ' + err);
    }
  }
  Logger.log('sendDueEmails: sent ' + sentCount + ', failed ' + failed + ', ituloy bukas (kulang ang quota) ' + skipped + ', quota left ' + MailApp.getRemainingDailyQuota());
  if (skipped > 0) warnQuotaLow_(skipped);
}

/** Isang beses kada araw lang magpapadala ng babala kay Joey kapag naubos ang quota at may naiwang emails. */
function warnQuotaLow_(skipped) {
  try {
    var props = PropertiesService.getScriptProperties();
    var todayKey = String(dayNumber_(new Date()));
    if (props.getProperty('QUOTA_WARN_DAY') === todayKey) return;
    if (MailApp.getRemainingDailyQuota() < 1) return;
    props.setProperty('QUOTA_WARN_DAY', todayKey);
    MailApp.sendEmail({
      to: CONFIG.NOTIFY_EMAIL,
      subject: 'Alara Village: naubos ang email quota, ' + skipped + ' email ang ituloy bukas',
      body: 'Naubos ang daily email quota ng Google account. May ' + skipped + ' lead na hindi pa napadalhan ngayong araw; ipapadala ito bukas ng ' + CONFIG.SEND_HOUR + ':00 AM (Asia/Manila).\n\n' +
        'Tip: ilipat sa status na Contacted, Consultation Scheduled, Reserved o Not Proceeding ang mga lead na nakausap mo na para hindi na sila gumamit ng quota.'
    });
  } catch (err) { Logger.log('warnQuotaLow_ skipped: ' + err); }
}

/**
 * Tingnan ang email quota. Patakbuhin sa editor (tingnan ang Execution log) o gamitin ang menu: Alara Leads > Check email quota.
 * Ipinapakita ang natitirang quota ngayon, ilang email ang kailangang ipadala ngayong araw, at kung kakasya.
 */
function checkEmailQuota() {
  var remaining = MailApp.getRemainingDailyQuota();
  var info = getDueList_(getSheet_());
  var due = info.due.length;
  var after = remaining - due;
  var lines = [
    'EMAIL QUOTA',
    'Natitirang quota ngayon: ' + remaining + ' emails',
    '(Karaniwan ay mga 100 kada araw ang libreng Gmail at mga 1,500 sa Google Workspace. Nagre-reset ito pagkalipas ng 24 oras.)',
    '',
    'SEQUENCE',
    'Mga lead na nasa sequence pa: ' + info.active,
    'Emails na dapat ipadala ngayong araw: ' + due,
    'Matitira pagkatapos: ' + after,
    '',
    after >= 0
      ? 'Kakasya ang quota ngayong araw. Tandaan na ang bawat bagong lead ay gagamit ng 2 emails (1 notification kay Joey at 1 sa buyer).'
      : 'KULANG ang quota ngayong araw: ' + Math.abs(after) + ' email ang maiiwan at ipapadala bukas. Isaalang-alang ang Google Workspace, o ilipat ang status ng mga lead na nakausap mo na.'
  ];
  var text = lines.join('\n');
  Logger.log(text);
  try { SpreadsheetApp.getUi().alert('Email quota', text, SpreadsheetApp.getUi().ButtonSet.OK); } catch (err) { /* hindi nakabukas mula sa Sheet; sa Execution log na lang makikita */ }
  return { remaining: remaining, active: info.active, dueToday: due, after: after };
}

/** Naglalagay ng menu na "Alara Leads" sa Google Sheet para madaling i-click ang mga tool. */
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('Alara Leads')
      .addItem('Check email quota', 'checkEmailQuota')
      .addItem('Send due emails now', 'sendDueEmails')
      .addSeparator()
      .addItem('Send 30 preview emails to test address', 'previewAllEmails')
      .addToUi();
  } catch (err) { /* hindi container-bound */ }
}

function sendSequenceEmail_(sheet, rowNum, index) {
  var r = sheet.getRange(rowNum, 1, 1, HEADERS.length).getValues()[0];
  if (r[COL['Consent']] !== 'YES' || r[COL['Unsubscribed']]) return;
  var sent = Number(r[COL['Emails Sent']]) || 0;
  if (sent !== index) return; // iwas double send
  var first = String(r[COL['Name']]).split(' ')[0];
  var mail = buildEmail_(index, first, r[COL['Unsub Token']], r);
  var opts = {
    to: r[COL['Email']], subject: mail.subject, body: mail.text, htmlBody: mail.html,
    name: CONFIG.AGENT_NAME + ' | ' + CONFIG.BRAND, replyTo: CONFIG.AGENT_EMAIL
  };
  if (mail.images) opts.inlineImages = mail.images;
  if (mail.pdf) opts.attachments = [mail.pdf];
  MailApp.sendEmail(opts);
  sheet.getRange(rowNum, COL['Emails Sent'] + 1).setValue(index + 1);
  sheet.getRange(rowNum, COL['Last Email At'] + 1).setValue(new Date());
}

function baseUrl_() { return CONFIG.WEB_APP_URL || ScriptApp.getService().getUrl() || ''; }
function pageUrl_() { return CONFIG.PAGE_URL || ''; }
function unsubUrl_(token) {
  var base = baseUrl_();
  if (base) return base + (base.indexOf('?') === -1 ? '?' : '&') + 'unsub=' + encodeURIComponent(token);
  // fallback kung wala pang deployed URL: mailto para hindi sirang link
  return 'mailto:' + CONFIG.AGENT_EMAIL + '?subject=' + encodeURIComponent('Unsubscribe');
}

/* ---------------------------------------------------------- email content */

/** Personalized na tugon base sa "Biggest Concern" ng lead. */
function concernNote_(r) {
  if (!r) return '';
  var main = String(r[COL['Biggest Concern']] || '').trim();
  var other = String(r[COL['Other Concern']] || '').trim();
  var c = (main + ' ' + other).toLowerCase();
  if (!c.trim()) return '';
  if (/budget|presyo|price|afford|gastos|cost|mahal/.test(c))
    return 'Naiintindihan ko na ang **budget** ang pinakamabigat sa isip mo. Kaya sa numbers na kaya mo tayo magsisimula, hindi sa presyong nakasulat lang sa brochure.';
  if (/loan|financ|approv|pag-?ibig|bank|utang|requirement/.test(c))
    return 'Normal lang ang kabahan sa **loan approval**. Ipapaliwanag ko ang mga hakbang at requirements nang malinaw para alam mo ang aasahan bago ka mag-commit sa anuman.';
  if (/down ?payment|\bdp\b/.test(c))
    return 'Ang **down payment** ang madalas na pinakamalaking harang. Titingnan natin ang plano base sa halagang kaya mong ilaan kada buwan.';
  if (/location|lokasyon|layo|commute|traffic|biyahe/.test(c))
    return 'Mahalaga ang **lokasyon**: dapat sulit ang biyahe papunta sa trabaho, paaralan, at pamilya. Pag-uusapan natin ito nang tapat.';
  if (/developer|legit|scam|trust|turnover|delay|title/.test(c))
    return 'Tama lang na mag-ingat. Sasabihin ko sa iyo kung ano ang dapat i-verify at itanong **bago** ka pumirma ng anuman.';
  return 'Nabanggit mo na ang pinaka-concern mo ay "' + (other || main) + '". Isasama ko ito sa pag-uusapan natin.';
}

/**
 * Lahat ng content ay plain text (may **bold** lang). Parehong HTML at plain-text version ang gagawin dito.
 * Mga field: phase (cold/warm/hot), subject, pre (preheader), headline, intro[], painTitle, pains[], benTitle, bens[], benNumbered,
 *            guideTitle, guide[] (optional "step-by-step guide" box), guideNumbered,
 *            closing[], cta, ctaSubject, ps, showSummary
 */
function baseSequence_(first, r) {
  var loc = r ? String(r[COL['Preferred Location']] || '').trim() : '';
  var plan = r ? String(r[COL['Financing Plan']] || '').trim() : '';
  var reason = r ? String(r[COL['Main Reason']] || '').trim() : '';

  var locLine = loc ? ' Dahil ' + loc + ' ang gusto mo, doon natin uunahing ihambing ang mga option.' : '';
  var planLine = plan ? ' Nabanggit mong ' + plan + ' ang gusto mong payment plan, kaya iyon ang gagamitin kong batayan.' : '';

  return [

    /* ===================== COLD (Day 1 - 10): gising ang problema, walang pressure ===================== */

    { // Email 1: Day 1
      phase: 'cold',
      subject: first + ', natanggap na ni Joey ang inquiry mo',
      pre: 'Ito ang susunod na mangyayari. Walang obligasyon.',
      headline: 'Nasa tamang direksyon ka na.',
      intro: [
        'Salamat sa tiwala, ' + first + '. Natanggap ko ang consultation details mo at personal kong susuriin ang bawat sagot.',
        'Aaminin ko: ang pagbili ng bahay ay hindi lang tungkol sa presyo. Ito ang mga madalas na iniisip ng mga buyer:'
      ],
      painTitle: 'Kilala mo ba ang mga ito?',
      pains: [
        '**Renta na walang napupundar.** Bawat buwan may malaking bayad, pero walang naiipon na sariling bahay.',
        '**Hindi malinaw na cash-out.** Iba ang presyo sa brochure sa aktwal na kailangan mong ilabas.',
        '**Pangamba sa loan approval.** Hindi alam kung saan magsisimula o kung kakayanin ba.',
        '**Nauubos na weekends.** Paikot-ikot sa mga bahay na hindi pala pasok sa budget.'
      ],
      benTitle: 'Ito ang lilinawin natin sa consultation',
      bens: [
        'Malinaw na **sample computation**: down payment, monthly, at total cash-out',
        'Mga option na pasok sa **budget at payment plan** mo',
        'Maingat na gabay sa **financing steps**, kasama ang posibleng hadlang',
        'Walang obligasyon at walang pressure na mag-reserve'
      ],
      showSummary: true,
      closing: ['Hindi mo kailangang mag-isa dito. Ako ang sasagot sa mga tanong na hindi nasasagot ng brochure.'],
      cta: 'I-reply ang best time para tawagan ka',
      ctaSubject: 'Pinakamagandang oras para tawagan ako',
      ps: 'Gusto mo ng mas mabilis na sagot? I-text o tawagan mo ako nang diretso.'
    },

    { // Email 2: Day 3
      phase: 'cold',
      subject: 'Magkano na ang naibayad mo sa renta? (kuwentahin natin)',
      pre: 'Ang buwanang renta ay tahimik na gastos na malaki pala kapag pinagsama.',
      headline: 'Ang renta ay hindi "maliit" kapag pinagsama-sama.',
      intro: [
        'Kumusta, ' + first + '? Subukan nating kuwentahin ang isang bagay na bihirang kuwentahin.',
        'Halimbawa, kung **₱10,000** ang buwanang renta, ₱120,000 iyon sa isang taon at **₱600,000 sa loob ng 5 taon**. Pero pagkatapos ng lahat ng bayad na iyon, ang tanong: ano ang pag-aari mo?'
      ],
      painTitle: 'Ang hindi napapansing bigat ng renta',
      pains: [
        '**Walang equity.** Lahat ng bayad ay napupunta sa may-ari, hindi sa iyo.',
        '**Pwedeng tumaas ang renta** taon-taon, pero hindi tumataas ang pag-aari mo.',
        '**Walang katiyakan.** Pwede kang lumipat anumang oras kung ibenta o kunin ng may-ari ang unit.'
      ],
      benTitle: 'Ano ang nagbabago kapag may sariling bahay',
      bens: [
        'Ang buwanang hulog ay papunta sa **bahay na magiging iyo**',
        'May **katiyakan** ang tirahan ng pamilya mo',
        'May **ari-arian** kang maipapamana o magagamit sa hinaharap'
      ],
      guideTitle: 'Gabay: Gawin ito sa loob ng 3 minuto',
      guide: [
        'Isulat ang kasalukuyang **buwanang renta** mo.',
        'I-multiply ng **12**, tapos ng **5**. Iyon ang halagang mailalabas mo sa 5 taon.',
        'Ipadala sa akin ang numerong iyon at ipapakita ko kung **ano ang sample monthly payment** na maihahambing doon.'
      ],
      guideNumbered: true,
      closing: ['Hindi ko sinasabing agad kang bumili. Gusto ko lang na makita mo ang **totoong numero**, para ikaw mismo ang magpasya.'],
      cta: 'Gusto kong ikumpara ang renta ko',
      ctaSubject: 'Paghahambing ng renta at buwanang hulog',
      ps: ''
    },

    { // Email 3: Day 5
      phase: 'cold',
      subject: 'Bago pumirma: 5 tanong na dapat malinaw muna',
      pre: 'Ang pinakamahal na pagkakamali ay ang pumirma nang hindi malinaw ang numbers.',
      headline: 'Hindi lang presyo ang dapat bantayan.',
      intro: [
        'Kumusta, ' + first + ',',
        'Ang pinakamahal na pagkakamali ay ang **pumirma nang hindi buo ang computation**. Hindi dahil mataas ang presyo, kundi dahil may mga bayaring hindi mo inasahan.'
      ],
      painTitle: 'Mga sitwasyong gusto nating maiwasan',
      pains: [
        'Nagulat sa mga dagdag na bayarin pagkatapos pumirma',
        'Nahirapan sa monthly payment ilang buwan pagkatapos',
        'Nalamang hindi pala kasama sa presyo ang inaasahan nilang inclusions'
      ],
      benTitle: 'Ang 5 tanong na dapat may malinaw na sagot',
      bens: [
        'Magkano ang **total cash-out**, kasama ang lahat ng fees?',
        'Ano ang eksaktong **specs at inclusions**?',
        'Kaya ba ng budget ang **monthly payment** sa pangmatagalan?',
        'Ano ang access sa trabaho, paaralan, at pamilihan, at kailan ang **turnover**?',
        'Ano ang plano kung **hindi ma-approve** ang unang financing option?'
      ],
      benNumbered: true,
      closing: ['Kung may isa sa lima na hindi mo pa masagot, normal lang iyon. Mag-reply ka lang dito at sasamahan kitang buuin ang sagot, step by step.'],
      cta: 'Ipasagot kay Joey ang mga tanong ko',
      ctaSubject: 'Mga tanong ko tungkol sa Alara Village',
      ps: ''
    },

    { // Email 4: Day 7
      phase: 'cold',
      subject: '"Hindi ako puwede, kulang ang ipon ko." Totoo ba?',
      pre: 'Ang 4 na paniniwalang pumipigil sa maraming pamilya bago pa man magtanong.',
      headline: 'Baka may paniniwalang hindi na akma sa sitwasyon mo.',
      intro: [
        'Maraming pamilya ang hindi na nagtatanong dahil may **paniniwalang** inakala nilang totoo. Hindi lahat ng ito ay mali, pero **marami ang hindi tama sa lahat ng sitwasyon**.',
        'Hindi ko hinuhulaan ang sitwasyon mo, ' + first + '. Gusto ko lang na hindi ka titigil sa pagtatanong dahil sa maling akala.'
      ],
      painTitle: 'Mga paniniwalang madalas nagiging hadlang',
      pains: [
        '"Kailangan ko ng malaking ipon bago magsimula."',
        '"Hindi ako ma-aapprove dahil hindi malaki ang sahod ko."',
        '"Para lang sa may negosyo o mataas ang posisyon ang bahay."',
        '"Mas mabuting maghintay muna ng tamang panahon."'
      ],
      benTitle: 'Ang mas tapat na larawan',
      bens: [
        'Nag-iiba ang kailangan sa unang bayad **depende sa option at payment plan**',
        'Hindi lang sahod ang tinitingnan; kasama ang **kabuuang kita, obligasyon, at dokumento**',
        'Maraming empleyado at self-employed ang **dumadaan sa tamang proseso**',
        'Hindi ito hula: **computation lang ang makakasagot**'
      ],
      closing: ['Hindi ko magagarantiya ang approval, pero masasabi ko kung **nasaan ka na** at **ano pa ang kulang**, nang walang bayad at walang pressure.'],
      cta: 'Pa-check ng sitwasyon ko',
      ctaSubject: 'Pa-check ng sitwasyon ko',
      ps: ''
    },

    { // Email 5: Day 10
      phase: 'cold',
      subject: 'Checklist: mga dokumentong karaniwang kailangan sa financing',
      pre: 'Ihanda na ito ngayon para mas maayos at mabilis ang proseso mamaya.',
      headline: 'Mas maayos ang financing kapag handa ang mga papeles.',
      intro: [
        'Maraming naaantala hindi dahil hindi qualified, kundi dahil **kulang o magulo ang dokumento** pagdating ng araw ng pag-apply.',
        'Kaya heto ang simpleng checklist na puwede mong simulan ngayon, kahit hindi ka pa nagre-reserve.'
      ],
      painTitle: 'Mga karaniwang dahilan ng pagkaantala',
      pains: [
        'Expired o malabong **valid ID**',
        'Walang malinaw na **proof of income**, lalo na sa self-employed o may sideline',
        'Hindi pa updated ang **TIN** o ang Pag-IBIG records',
        'Biglang bagong utang habang nagpoproseso ng loan'
      ],
      benTitle: 'Ano ang mapapala mo kapag handa na',
      bens: [
        'Mas **mabilis ang pag-evaluate** ng application',
        'Mas **malinaw kung anong option** ang bagay sa iyo',
        'Mas **kaunting stress** at pabalik-balik'
      ],
      guideTitle: 'Gabay: Checklist ng karaniwang dokumento',
      guide: [
        '**Dalawang valid government ID**, malinaw at hindi expired',
        '**TIN**, at kung Pag-IBIG ang plano: **Pag-IBIG MID number** at updated na kontribusyon',
        'Empleyado: **payslips at Certificate of Employment**',
        'Self-employed o may negosyo: **ITR, bank statements, at business permit** kung mayroon',
        'Kung may co-borrower: **kaparehong dokumento** niya rin'
      ],
      guideNumbered: false,
      closing: ['Nag-iiba ang eksaktong requirements depende sa bangko, Pag-IBIG, o developer. Ipapaalam ko ang eksaktong listahan para sa napili mong option.'],
      cta: 'Pa-check ng papeles ko',
      ctaSubject: 'Tulong sa document checklist',
      ps: 'Kung hindi ka sigurado kung kasama ang isang dokumento, itanong mo lang.'
    },

    /* ===================== WARM (Day 11 - 20): tiwala, sagot sa mga duda ===================== */

    { // Email 6: Day 12
      phase: 'warm',
      subject: 'Mga bayaring hindi laging nakikita sa brochure, ' + first,
      pre: 'Para hindi ka magulat sa cash-out. Tingnan ang listahang ito.',
      headline: 'Ihanda ang buong budget, hindi lang ang presyo.',
      intro: [
        'Isa sa pinakamadalas kong marinig: **"Akala ko ito lang ang babayaran."**',
        'Walang masama sa tanong. Ang masama ay malaman mo lang ito pagkatapos mong pumirma.'
      ],
      painTitle: 'Bakit nagugulat ang mga buyer',
      pains: [
        'Hindi napag-usapan ang **miscellaneous fees** at processing charges',
        'Hindi naisama sa budget ang **gastos sa paglipat** at pag-aayos ng bahay',
        'Hindi napaghandaan ang **monthly dues at utilities** sa bagong lugar'
      ],
      benTitle: 'Ang gusto nating mangyari',
      bens: [
        'Alam mo ang **kabuuang halaga** bago mag-commit',
        'May **buffer** ang budget mo para sa hindi inaasahan',
        'Komportable ka sa hulog, hindi lang sa unang bayad'
      ],
      guideTitle: 'Gabay: Mga gastusing dapat itanong',
      guide: [
        '**Reservation fee**: magkano, at refundable ba o hindi?',
        '**Down payment**: ilang buwan ang hulugan at magkano kada buwan?',
        '**Miscellaneous at processing fees**: kailan sisingilin at magkano ang tantiya?',
        '**Monthly amortization** at kung kailan ito magsisimula',
        '**Association dues** at iba pang buwanang singil pagkatapos ng turnover',
        'Gastos sa **paglipat at pag-aayos** ng bahay'
      ],
      guideNumbered: false,
      closing: ['Ibibigay ko sa iyo ang **malinaw na listahan ng lahat ng ito** sa sample computation, para wala kang hulaan.'],
      cta: 'Pakilista ang total cash-out',
      ctaSubject: 'Buong breakdown ng cash-out',
      ps: ''
    },

    { // Email 7: Day 14
      phase: 'warm',
      subject: '"May utang ako. Puwede pa ba?" (sagot ni Joey)',
      pre: 'Isa ito sa pinakamadalas na tanong. Narito ang tapat na sagot.',
      headline: 'May existing na utang? Hindi ibig sabihin na hindi ka na puwede.',
      intro: [
        'Kumusta, ' + first + '. Madalas itong itanong sa akin: **"Joey, may hulog pa ako sa sasakyan at credit card. Puwede pa ba ako sa bahay?"**',
        'Ang tapat kong sagot: **depende sa kabuuang larawan**, hindi lang sa isang numero. Maraming buyer ang nagtagumpay dahil inayos nila ang plano bago mag-apply.'
      ],
      painTitle: 'Ang mga pangamba ng maraming buyer',
      pains: [
        '"Baka ma-deny ako dahil may utang pa ako."',
        '"Hindi ko alam kung gaano kalaki ang kaya kong hulugan."',
        '"Baka masira ang finances ko kapag nag-commit ako."'
      ],
      benTitle: 'Ano ang magagawa natin',
      bens: [
        'Titingnan natin ang **kabuuang obligasyon** mo, hindi lang ang bahay',
        'Pag-uusapan natin kung **ano ang dapat unahin o ayusin** bago mag-apply',
        'Hahanap tayo ng option na **hindi bubuwal** sa budget mo'
      ],
      guideTitle: 'Gabay: 4 na hakbang para mas handa sa loan',
      guide: [
        '**Ilista ang lahat ng utang**: balanse, buwanang hulog, at kailan matatapos.',
        '**Huwag munang kumuha ng bagong utang** o mag-installment ng malaking gamit habang naghahanda.',
        '**Magbayad nang maaga at tama** sa credit card at iba pang hulog.',
        '**Mag-ipon ng proof** ng regular na kita at ipon (payslip, bank statement).'
      ],
      guideNumbered: true,
      closing: ['Hindi ako bangko at hindi ko magagarantiya ang approval. Pero **matutulungan kitang maghanda nang tama** para mas malinaw ang pupuntahan mo.'],
      cta: 'Ipa-review ang sitwasyon ko',
      ctaSubject: 'Please review my situation',
      ps: ''
    },

    { // Email 8: Day 16
      phase: 'warm',
      subject: 'Pag-IBIG, bangko, o in-house? Paano pumili, ' + first,
      pre: 'Ito ang itatanong mo para hindi ka magsisi sa financing na pipiliin.',
      headline: 'Hindi pare-pareho ang financing. Piliin ang bagay sa iyo.',
      intro: [
        'May mga buyer na pumipili ng financing dahil lang iyon ang unang narinig nila. Kaya pag-usapan natin kung **paano ihambing** ang mga option.' + planLine,
        'Hindi ko sasabihin na isa lang ang tama. Ang tama ay ang pasok sa **kita, plano, at timeline** mo.'
      ],
      painTitle: 'Mga pagkakamali sa pagpili ng financing',
      pains: [
        'Tinitingnan lang ang **unang bayad**, hindi ang kabuuang gastos sa mahabang panahon',
        'Hindi nagtanong tungkol sa **pagbabago ng interest rate** at penalties',
        'Hindi inihambing ang **terms** ng iba pang option'
      ],
      benTitle: 'Ano ang makukuha mo sa pag-compare',
      bens: [
        'Mas **malinaw na hulog** sa buong term ng loan',
        'Mas kaunting **sorpresa** sa mga susunod na taon',
        'Mas **panatag ang desisyon** dahil alam mong tiningnan mo ang mga option'
      ],
      guideTitle: 'Gabay: Itanong ito sa bawat option',
      guide: [
        'Magkano ang **interest rate** at **fixed ba ito o puwedeng magbago**?',
        'Ilang taon ang **loan term** at magkano ang hulog sa bawat term?',
        'May **penalty** ba kung maaga o maantala ang bayad?',
        'Anong **dokumento at kita** ang hinihingi?',
        'Gaano katagal ang **proseso hanggang approval**?'
      ],
      guideNumbered: true,
      closing: ['Ipapaliwanag ko ang bawat option sa simpleng salita at ipapakita ang sample computation para sa bawat isa, para **ikaw mismo ang makapagpasya**.'],
      cta: 'Gusto kong ma-compare ang options',
      ctaSubject: 'Financing options comparison',
      ps: ''
    },

    { // Email 9: Day 18
      phase: 'warm',
      subject: 'Paano malaman kung legit ang developer? (5 bagay na i-verify)',
      pre: 'Tama lang na mag-ingat. Narito kung ano ang titingnan bago ka mag-commit.',
      headline: 'Tama lang na magduda. Ito ang titingnan mo.',
      intro: [
        'Kumusta, ' + first + '. Sa dami ng nababalitaang problema sa mga proyekto, **normal at matalino** ang mag-ingat bago maglabas ng pera.',
        'Hindi mo kailangang maniwala lang sa sinasabi ng kahit sino, kasama ako. Kaya heto ang mga bagay na **puwede mong i-verify mismo**.'
      ],
      painTitle: 'Ang mga takot ng maraming buyer',
      pains: [
        '"Baka hindi matapos o ma-delay ang proyekto."',
        '"Baka may problema sa titulo."',
        '"Baka iba ang ibinigay sa ipinangako."'
      ],
      benTitle: 'Ano ang makukuha mo kapag na-verify mo',
      bens: [
        '**Kapayapaan ng isip** bago mag-commit',
        'Mas **malinaw na batayan** sa pagdedesisyon',
        'Mas **protektado ka** sa mga problemang maiiwasan'
      ],
      guideTitle: 'Gabay: Ano ang dapat itanong at i-check',
      guide: [
        '**License to Sell at Certificate of Registration** ng proyekto mula sa DHSUD',
        'Estado ng **titulo** at kung ano ang proseso ng paglilipat nito sa pangalan mo',
        '**Nakasulat na timeline ng turnover** at kung ano ang mangyayari kung ma-delay',
        '**Nakasulat na listahan ng inclusions at specs**',
        '**Lahat ng bayad ay may opisyal na resibo**, at basahin ang buong kontrata bago pumirma'
      ],
      guideNumbered: true,
      closing: ['Kung gusto mo, tutulungan kitang buuin ang listahan ng itatanong, at **ikaw mismo ang magve-verify** bago ka mag-decide.'],
      cta: 'Ipadala ang checklist ng i-verify',
      ctaSubject: 'Verification checklist request',
      ps: ''
    },

    { // Email 10: Day 20
      phase: 'warm',
      subject: 'Pag-usapan na ba ito ng pamilya mo, ' + first + '?',
      pre: 'Mas matibay ang desisyon kapag buo ang pamilya. May gabay ako para diyan.',
      headline: 'Mas panatag ang desisyon kapag magkakasama.',
      intro: [
        'Ang pagbili ng bahay ay hindi lang desisyon ng isang tao. Madalas, **buong pamilya** ang titira at magbabayad.' + (reason ? ' Nabanggit mong ang pangunahing dahilan mo ay "' + reason + '", at tiyak na may kaugnayan ito sa pamilya.' : ''),
        'Kung may asawa, magulang, o kapatid na kasama sa plano, mainam na sabay-sabay kayong makarinig ng numbers at plano.'
      ],
      painTitle: 'Ang madalas mangyari kapag hindi magkakasundo',
      pains: [
        'May nagdududa dahil **kulang ang impormasyon**',
        'Nagkakaiba ang **inaasahan sa budget at lokasyon**',
        'Napapahaba ang desisyon dahil **hindi sabay-sabay ang usapan**'
      ],
      benTitle: 'Paano ko kayo matutulungan',
      bens: [
        'Puwede tayong mag-**group call** o magkita nang sabay-sabay',
        'Ipapaliwanag ko ang **computation at proseso** sa madaling maintindihan na paraan',
        'Sasagutin ko ang **tanong ng bawat isa** nang tapat'
      ],
      guideTitle: 'Gabay: 5 tanong na pag-usapan muna ng pamilya',
      guide: [
        'Magkano ang **komportableng hulog** kada buwan nang hindi isinasakripisyo ang pagkain, tuition, at ipon?',
        'Sino ang **magiging co-borrower** at sino ang titira?',
        'Ano ang **dapat meron** sa bahay at ano ang puwedeng ipagpaliban?',
        'Gaano kalayo ang **kaya ninyong biyahe** papunta sa trabaho at paaralan?',
        'Ano ang **plano kung may biglang mangyari** sa kita ng isa sa inyo?'
      ],
      guideNumbered: true,
      closing: ['Kapag handa na kayo, isang reply lang ang kailangan at aayusin ko ang schedule na bagay sa lahat.'],
      cta: 'Mag-set ng usapan kasama ang pamilya',
      ctaSubject: 'Family consultation schedule',
      ps: ''
    },

    /* ===================== HOT (Day 21 - 30): desisyon at aksyon, tapat na urgency ===================== */

    { // Email 11: Day 21
      phase: 'hot',
      subject: first + ', handa ka na ba? 3-minutong self-check',
      pre: 'Kung "oo" ka sa karamihan, oras na para sa susunod na hakbang.',
      headline: 'Handa ka na bang tingnan ang susunod na hakbang?',
      intro: [
        'Tatlong linggo na mula nang magsimula tayong mag-usap, ' + first + '. Maaaring may mga tanong ka pang hindi nasasagot, at okay lang iyon.',
        'Pero baka mas malapit ka na sa desisyon kaysa inaakala mo. Subukan ang maikling self-check na ito.'
      ],
      painTitle: 'Habang hindi pa nagdedesisyon',
      pains: [
        'Tuloy ang **buwanang bayad** sa tirahang hindi iyo',
        'Paulit-ulit na **naghahanap at nagtatanong**, pero walang malinaw na plano',
        'Nawawala ang **momentum** at bumabalik sa simula'
      ],
      benTitle: 'Kapag sumagot ka ng "oo" sa karamihan',
      bens: [
        'Handa ka nang **mag-schedule ng viewing o call**',
        'Puwede na akong gumawa ng **sample computation** para sa iyo',
        'Magsisimula na tayong **ihanda ang mga dokumento**'
      ],
      guideTitle: 'Gabay: Sagutin ng oo o hindi',
      guide: [
        'May **malinaw na budget** na ako para sa buwanang hulog.',
        'Alam ko na ang **lokasyong gusto ko**' + (loc ? ' (' + loc + ')' : '') + '.',
        'Napag-usapan na namin ito ng **pamilya**.',
        'May **plano** ako sa down payment.',
        'Gusto ko nang malaman ang **eksaktong numbers**.'
      ],
      guideNumbered: true,
      closing: ['Kung "oo" ka sa tatlo o higit pa, mag-reply ka lang ng **"HANDA NA"** at ako na ang magsisimula sa susunod na hakbang. Walang obligasyong mag-reserve.'],
      cta: 'Mag-reply ng "HANDA NA"',
      ctaSubject: 'HANDA NA',
      ps: ''
    },

    { // Email 12: Day 23
      phase: 'hot',
      subject: 'Ano ang mangyayari sa viewing? (walang pressure)',
      pre: 'Para alam mo ang aasahan at hindi ka kabahan.',
      headline: 'Ang viewing ay para makatulong sa desisyon mo.',
      intro: [
        'May ilang buyer na hindi nagsisimula dahil kabado sa viewing. Baka iniisip nilang **pipilitin silang mag-reserve** o hindi sila pasok.',
        'Para mawala ang pangamba, heto ang aktwal na mangyayari.' + locLine
      ],
      painTitle: 'Mga pangamba bago mag-viewing',
      pains: [
        '"Baka pilitin akong mag-decide agad."',
        '"Baka hindi pala bagay sa budget ko."',
        '"Baka maaksaya lang ang oras ko."'
      ],
      benTitle: 'Ano ang makukuha mo sa viewing',
      bens: [
        'Makikita mo ang **aktwal na lugar**, hindi lang litrato',
        'May **sagot sa lahat ng tanong** mo, kasama ang computation',
        'Malalaman mo kung **bagay ba talaga** sa pamilya mo, o hindi'
      ],
      guideTitle: 'Gabay: Ano ang mangyayari, hakbang-hakbang',
      guide: [
        'Pumili ka ng **petsa at oras** (onsite o online), subject sa availability.',
        'Kukumpirmahin ko ang **schedule at kung saan magkikita**.',
        'Ililibot kita at **sasagutin ang mga tanong** mo.',
        'Ipapaliwanag ko ang **computation**. Ikaw ang magpapasya kung itutuloy o hindi.'
      ],
      guideNumbered: true,
      closing: ['Kung hindi ito bagay sa iyo, **sasabihin ko nang tapat**. Mas mabuting malaman mo ngayon kaysa pagkatapos pumirma.'],
      cta: 'Mag-book ng viewing',
      ctaSubject: 'Request para sa viewing',
      ps: ''
    },

    { // Email 13: Day 25
      phase: 'hot',
      subject: 'Ang halaga ng paghihintay, ' + first,
      pre: 'Hindi ito pananakot. Numero lang na dapat mong makita.',
      headline: 'Ano ang tunay na halaga ng paghihintay?',
      intro: [
        'Hindi ko sinasabing magmadali ka. Pero gusto kong makita mo ang **tunay na halaga ng paghihintay**, dahil bihira itong kuwentahin.',
        'Habang naghihintay ka ng "tamang panahon", tuloy-tuloy ang renta o iba pang gastos sa tirahan mo, at **maaaring magbago ang presyo at availability ng mga unit**.' + locLine
      ],
      painTitle: 'Ang kapalit ng paghihintay',
      pains: [
        '**Buwan-buwang bayad** na hindi bumabalik sa iyo',
        '**Posibleng pagbabago ng presyo** at paglabas ng mga unit sa merkado',
        '**Mas maraming buwang lumipas** nang hindi umaabante ang plano'
      ],
      benTitle: 'Kapag nagsimula ka na ngayon',
      bens: [
        'May **malinaw na numero** na hindi mo na kailangang hulaan',
        'Alam mo kung **kaya na ba** o ano pa ang kulang',
        'Hawak mo ang **mga option** habang bukas pa ang mga ito'
      ],
      closing: [
        'Ang sample computation ay **libre at walang obligasyon**. Sampung minuto ng usapan, at may numero ka na.' + planLine
      ],
      cta: 'Gusto ko ng sample computation ngayon',
      ctaSubject: 'Libreng sample computation',
      ps: 'Walang pressure na mag-reserve. Gusto ko lang na hindi ka manghula.'
    },

    { // Email 14: Day 28
      phase: 'hot',
      subject: 'Paano mag-reserve nang ligtas (kung desidido ka na)',
      pre: 'Kung handa ka na, ito ang dapat mong siguraduhin bago maglabas ng pera.',
      headline: 'Kung magre-reserve ka, gawin natin ito nang maingat.',
      intro: [
        'Kung nasa punto ka nang gusto mo nang mag-reserve, ' + first + ', **magandang balita iyon**. Pero dapat gawin ito nang maingat.',
        'Walang dapat madaliin nang hindi malinaw. Heto ang mga dapat mong siguraduhin.'
      ],
      painTitle: 'Mga pagkakamali sa pagre-reserve',
      pains: [
        'Nagbayad nang **walang nakasulat na kasunduan**',
        'Hindi alam kung **refundable ba ang reservation fee**',
        'Nagbayad sa **hindi opisyal na channel** o walang resibo'
      ],
      benTitle: 'Ang gusto nating mangyari',
      bens: [
        'Malinaw ang **bawat bayad at kondisyon**',
        'May **opisyal na dokumentasyon** ng lahat',
        'Panatag ka sa **bawat hakbang**'
      ],
      guideTitle: 'Gabay: Checklist bago mag-reserve',
      guide: [
        'Hingin ang **nakasulat na computation** at kasunduan.',
        'Itanong kung **refundable ba ang reservation fee** at ano ang mga kondisyon.',
        'Siguraduhing **opisyal ang payment channel** at may **resibo** ang bawat bayad.',
        'Basahin ang **buong kontrata**, at magtanong sa hindi malinaw.',
        'Siguraduhing **alam ng buong pamilya** ang desisyon.'
      ],
      guideNumbered: true,
      closing: ['Kung handa ka na, sabihin mo lang at **sasamahan kita sa bawat hakbang**. Kung may duda pa, sagutin natin muna iyon.'],
      cta: 'Handa na akong mag-usap tungkol sa reservation',
      ctaSubject: 'Tanong tungkol sa reservation',
      ps: ''
    },

    { // Email 15: Day 30
      phase: 'hot',
      subject: 'Huling follow-up mula kay Joey, ' + first,
      pre: 'Malinaw na ba sa iyo ang totoong numbers ng pangarap mong bahay?',
      headline: 'Kung hindi pa ngayon, kailan magiging malinaw?',
      intro: [
        'Ito na ang huli kong follow-up para hindi na ako makaabala. Pero gusto kong iwan sa iyo ang isang tanong:',
        '**Malinaw na ba sa iyo ang totoong numbers ng pangarap mong bahay?**',
        'Kung hindi pa, hindi ito lilinaw sa pamamagitan ng paghihintay. Ang usapan lang ang makakagawa nito.'
      ],
      painTitle: 'Habang naghihintay',
      pains: [
        'Tuloy-tuloy ang buwanang bayad sa tirahang hindi iyo',
        'Maaaring magbago ang presyo at availability ng mga unit',
        'Nananatiling malabo ang plano dahil walang computation na batayan'
      ],
      benTitle: 'Bukas pa rin ang alok ko',
      bens: [
        '**Sample computation** na akma sa budget mo',
        'Pag-compare ng Alara Village sa ibang option kung iyon ang mas bagay sa iyo',
        'Sagot sa kahit anong tanong, kahit hindi ka pa handang mag-reserve'
      ],
      closing: [
        'Kung hindi pa tamang panahon, naiintindihan ko. Nandito lang ako kapag handa ka na. Isang reply lang ang kailangan.',
        'Salamat sa oras mo, ' + first + '. Anuman ang piliin mo, sana makuha mo ang tahanang karapat-dapat sa pamilya mo.'
      ],
      cta: 'Gusto ko ng sample computation',
      ctaSubject: 'Request para sa sample computation',
      ps: ''
    }
  ];
}

/** 15 dagdag na emails para maging isang email kada araw sa loob ng 30 araw. Pinagsasama ng sequence_() ang base at extra. */
function extraSequence_(first, r) {
  var loc = r ? String(r[COL['Preferred Location']] || '').trim() : '';
  var plan = r ? String(r[COL['Financing Plan']] || '').trim() : '';
  var dp = r ? String(r[COL['Monthly Down Payment']] || '').trim() : '';
  var locLine = loc ? ' Dahil ' + loc + ' ang gusto mo, doon ko iuuna ang pagtingin.' : '';
  var dpLine = dp ? ' Nabanggit mong mga ' + dp + ' ang kaya mong ilaan kada buwan sa down payment, kaya iyon ang gagamitin nating panimulang numero.' : '';
  var planLine = plan ? ' Ang ' + plan + ' ang payment plan na nabanggit mo, kaya doon ako magbabatay.' : '';
  var concern = concernNote_(r);

  var concernIntro = [
    'Kumusta, ' + first + '. Isang tanong lang ang gusto kong itanong ngayon, para hindi na ako manghula: **ano ang pinakamabigat na tanong mo tungkol sa pagbili ng bahay?**'
  ];
  if (concern) concernIntro.push(concern);

  return [

    { // x0: Day 3 (cold)
      phase: 'cold',
      subject: 'Huwag nang sayangin ang weekends sa maling options',
      pre: 'Hindi lahat ng viewing ay sulit. Ganito mo mas mapapaikli ang paghahanap.',
      headline: 'Hindi lahat ng viewing ay sulit sa weekend mo.',
      intro: [
        'Kumusta, ' + first + '? Ilang weekend na ba ang naubos sa pagtingin ng bahay na pagdating mo roon ay **alam mo nang hindi pasok**?',
        'Hindi ito dahil mali ang paghahanap mo. Madalas, wala lang malinaw na batayan kung ano ang hahanapin.' + locLine
      ],
      painTitle: 'Ang pagod ng paikot-ikot',
      pains: [
        'Nagbibiyahe nang malayo para sa bahay na **lampas pala sa budget**',
        'Nalilito dahil **sobrang daming option** na magkakaiba',
        'Napapagod at nauubos ang gana bago pa makapag-decide'
      ],
      benTitle: 'Kapag may malinaw na batayan',
      bens: [
        '**Mas kaunti pero mas tamang** mga bahay ang titingnan mo',
        'Mas **mabilis ang desisyon**',
        'Mas **maraming oras para sa pamilya**, hindi sa paghahanap'
      ],
      guideTitle: 'Gabay: Isulat ang 3 "dapat" at 3 "hindi puwede"',
      guide: [
        'Isulat ang **3 dapat meron** (halimbawa: bilang ng kuwarto, parking, lokasyon).',
        'Isulat ang **3 hindi mo kaya** (halimbawa: sobra sa budget na hulog, sobrang layo, walang malapit na paaralan).',
        'Ipadala sa akin ang dalawang listahan at **ako na ang magfi-filter** ng mga option.'
      ],
      guideNumbered: true,
      closing: ['Mas mabuting tatlong tamang bahay ang makita mo kaysa sampung hindi bagay.'],
      cta: 'Ipa-filter ang options ko',
      ctaSubject: 'Ipa-filter ang options ko',
      ps: ''
    },

    { // x1: Day 5 (cold)
      phase: 'cold',
      subject: 'Magkano ba talaga ang "kaya kong hulog"?',
      pre: 'Isang simpleng paraan para malaman kung ano ang komportable sa iyo.',
      headline: 'Ang kaya mo ay hindi dapat hula. Puwede natin itong kuwentahin.',
      intro: [
        'Kapag tinanong ng agent kung magkano ang kaya mong hulugan, madalas **hula** ang sagot. Pero puwede itong kuwentahin nang mas totoo.',
        'Hindi ko hinihingi ang sagot ngayon. Gusto ko lang ibigay ang paraan para ikaw mismo ang makapag-check.'
      ],
      painTitle: 'Ang mapanganib na hulaan',
      pains: [
        'Sumobra ang hulog at **nahirapan sa ibang gastusin**',
        'Sobrang liit ng inakalang kaya, kaya **nakaligtaan ang mga option** na pasok pala',
        'Walang **buffer** kapag may biglang gastos'
      ],
      benTitle: 'Kapag alam mo ang tunay mong kaya',
      bens: [
        'Hindi ka na **manghuhula** sa budget',
        'Makikita mo kung **ano ang pasok** at ano ang hindi',
        'May **plano** kang kayang panindigan'
      ],
      guideTitle: 'Gabay: 4 na hakbang sa pagkuwenta',
      guide: [
        'Isulat ang **kabuuang buwanang kita** ng sambahayan.',
        'Ibawas ang **kailangang gastusin**: pagkain, kuryente at tubig, tuition, pamasahe, at mga hulog sa utang.',
        'Ang matitira ang pagbabatayan, pero **huwag ilaan lahat** sa hulog.',
        'Mag-iwan ng **buffer** para sa emergency at hindi inaasahang gastos.'
      ],
      guideNumbered: true,
      closing: ['Gabay lang ito at hindi garantiya ng approval. Pero mas maganda nang may numero kang hawak bago tayo mag-usap.'],
      cta: 'Tulungan akong kuwentahin',
      ctaSubject: 'Tulungan akong kuwentahin ang kaya ko',
      ps: ''
    },

    { // x2: Day 7 (cold)
      phase: 'cold',
      subject: 'Ang tunay na cost ng malayong lokasyon',
      pre: 'Ang murang bahay na malayo ay maaaring hindi pala mura.',
      headline: 'Minsan, mas mahal ang bahay na malayo.',
      intro: [
        'Kumusta, ' + first + '. May bahay na mukhang mura sa presyo, pero **mabigat pala sa biyahe**: sa pera, oras, at lakas.' + locLine,
        'Kaya mahalagang isama ang biyahe sa kuwenta, hindi lang ang halaga ng bahay.'
      ],
      painTitle: 'Ang itinatagong gastos ng layo',
      pains: [
        '**Pamasahe o gasolina** na paulit-ulit araw-araw',
        '**Oras sa biyahe** na dapat sana ay para sa pamilya o pahinga',
        '**Pagod** na nakakaapekto sa trabaho at sa bahay'
      ],
      benTitle: 'Kapag tama ang lokasyon',
      bens: [
        'Mas **maraming oras** sa pamilya',
        'Mas **kaunting gastos** sa biyahe',
        'Mas **magaan ang araw-araw**'
      ],
      guideTitle: 'Gabay: Kuwentahin ang biyahe mo',
      guide: [
        'Bilangin ang **araw ng pasok** kada buwan.',
        'I-multiply sa **pamasahe o gasolina** papunta at pabalik.',
        'Isulat ang **oras na ginugugol** sa biyahe araw-araw.',
        'Ihambing ang numero para sa **dalawa o tatlong lokasyong iniisip mo**.'
      ],
      guideNumbered: true,
      closing: ['Ang tamang lokasyon ay hindi laging pinakamalapit. Ito ang **pinakabagay sa buhay mo**, at doon tayo magsisimula.'],
      cta: 'Ikumpara ang mga lokasyon ko',
      ctaSubject: 'Ikumpara ang mga lokasyon ko',
      ps: ''
    },

    { // x3: Day 9 (cold)
      phase: 'cold',
      subject: 'Down payment: paano mag-ipon kahit paunti-unti',
      pre: 'Hindi mo kailangang may malaking halaga agad. Narito ang simpleng sistema.',
      headline: 'Ang down payment ay pinaghahandaan, hindi lang hinihintay.',
      intro: [
        'Ang **down payment** ang madalas na pinakamalaking harang. Pero para sa marami, ang problema ay hindi kakulangan ng kita kundi **walang sistema ng pag-iipon**.' + dpLine,
        'Heto ang simpleng paraan na puwede mong simulan ngayon.'
      ],
      painTitle: 'Bakit hindi naiipon ang pera',
      pains: [
        '**Nauubos** ang sahod bago pa makapag-ipon',
        'Walang **target**, kaya walang direksyon',
        'Naiipon pero **nagagalaw** kapag may biglang gastos'
      ],
      benTitle: 'Kapag may sistema',
      bens: [
        'May **malinaw na target** at timeline',
        'Hindi ka **nahihirapan** kasi awtomatiko',
        'Mas **handa ka** pagdating ng araw ng reservation'
      ],
      guideTitle: 'Gabay: Sistema ng pag-iipon sa 5 hakbang',
      guide: [
        'Magtakda ng **buwanang halaga**, kahit maliit, basta kaya mong panindigan.',
        'Magbukas ng **hiwalay na account** para sa down payment lang.',
        'Gawing **awtomatiko** ang paglipat ng pera pagkatapos ng sahod.',
        'Ilaan ang **bonus, 13th month, o dagdag na kita** kapag mayroon.',
        'Sabihin sa akin ang halaga para **ayusin ang payment plan** na bagay sa iyo.'
      ],
      guideNumbered: true,
      closing: ['May mga paraan para hatiin ang unang bayad, depende sa option. Ipapaliwanag ko iyon sa sample computation.'],
      cta: 'Gusto kong ayusin ang down payment plan',
      ctaSubject: 'Down payment plan',
      ps: ''
    },

    { // x4: Day 10 (cold)
      phase: 'cold',
      subject: 'Isang tanong lang, ' + first + ': nasaan ka na sa susunod na 5 taon?',
      pre: 'Hindi ito benta. Isang tanong lang na sulit pag-isipan.',
      headline: 'Nasaan ka na limang taon mula ngayon?',
      intro: [
        'Hindi ito pang-benta. Isang tanong lang na madalas nakakalimutan sa gitna ng computation at brochure.',
        '**Saan mo gustong nakatira ang pamilya mo limang taon mula ngayon?**'
      ],
      painTitle: 'Kapag walang malinaw na larawan',
      pains: [
        'Lumilipas ang mga taon nang **walang pagbabago sa tirahan**',
        'Napapagod sa paulit-ulit na **paglipat o pagtaas ng renta**',
        'Naipagpapaliban ang plano dahil **walang konkretong hakbang**'
      ],
      benTitle: 'Kapag malinaw ang larawan',
      bens: [
        'Mas **madaling magdesisyon** kung ano ang bagay sa iyo',
        'Mas **may direksyon** ang bawat ipon at gastos',
        'Mas **may sigla** ang paghahanda'
      ],
      guideTitle: 'Gabay: Sagutin sa isip (o sa papel)',
      guide: [
        'Sino ang **titira** sa bahay at ilan sila?',
        'Ano ang **araw-araw na buhay** na gusto mo roon?',
        'Ano ang **isang bagay** na gusto mong mawala sa kasalukuyan mong tirahan?'
      ],
      guideNumbered: true,
      closing: ['Kung gusto mo, i-reply ang sagot mo sa isang pangungusap. **Doon ko ibabatay** ang mga susunod kong mungkahi.'],
      cta: 'I-reply ang sagot ko',
      ctaSubject: 'My answer',
      ps: ''
    },

    { // x5: Day 13 (warm)
      phase: 'warm',
      subject: '"Paano kung magkamali ako ng desisyon?" (tapat na sagot)',
      pre: 'Normal ang matakot. Ito ang mga tanong na nagpoprotekta sa iyo.',
      headline: 'Normal lang matakot magkamali. Heto ang makakatulong.',
      intro: [
        'Walang buyer na hindi nagtanong nito: **"Paano kung magkamali ako?"**',
        'Hindi ko maipapangako na walang panganib, pero **may mga tanong na puwede mong itanong** para mabawasan ito nang malaki.'
      ],
      painTitle: 'Ang mga takot na totoo',
      pains: [
        '"Paano kung hindi ko na kayanin ang hulog?"',
        '"Paano kung magbago ang isip ko pagkatapos mag-reserve?"',
        '"Paano kung may hindi ako nabasa sa kontrata?"'
      ],
      benTitle: 'Kapag alam mo ang mga sagot bago pumirma',
      bens: [
        'Alam mo ang **mga opsyon** kapag nagkaproblema',
        'Hindi ka **nagugulat** sa mga kondisyon',
        'Mas **panatag** ang desisyon mo'
      ],
      guideTitle: 'Gabay: Mga tanong na nagpoprotekta sa iyo',
      guide: [
        'Ano ang mangyayari kung **maantala o hindi ko makayanan ang hulog**? May grace period ba at ano ang penalty?',
        '**Refundable ba ang reservation fee** at ano ang mga kondisyon?',
        'Ano ang **mga opsyon** kung kailangan kong magbago ng plano?',
        'Nakasulat ba **lahat ng napag-usapan** at naipaliwanag ba ang bawat probisyon ng kontrata?'
      ],
      guideNumbered: true,
      closing: ['Hindi ako ang magdidikta ng desisyon mo. Trabaho kong tiyakin na **buo ang impormasyon mo** bago ka mag-commit.'],
      cta: 'Ipaliwanag ang mga kondisyon',
      ctaSubject: 'Ipaliwanag ang terms at conditions',
      ps: ''
    },

    { // x6: Day 15 (warm)
      phase: 'warm',
      subject: 'Viewing checklist: ano ang dapat mong tingnan',
      pre: 'Hindi mo kailangang maging engineer para mag-check ng bahay.',
      headline: 'Hindi mo kailangang maging engineer para makapag-check nang maayos.',
      intro: [
        'Kapag nasa viewing ka na, madaling maaliw sa ganda at makalimutang tingnan ang mahahalagang detalye.',
        'Heto ang mga bagay na **puwede mong i-check mismo**, kahit wala kang teknikal na kaalaman.'
      ],
      painTitle: 'Mga bagay na madalas hindi napapansin',
      pains: [
        'Bakas ng **tulo o basa** sa kisame at pader',
        'Mahinang **tubig o kuryente** na lumalabas lang pagkatapos tumira',
        'Mga **bitak o hindi sumasarang** pinto at bintana'
      ],
      benTitle: 'Kapag nakapag-check ka nang tama',
      bens: [
        'Mas **kaunting sorpresa** pagkatapos ng turnover',
        'May **batayan** ka sa pagtatanong at paghingi ng ayos',
        'Mas **panatag** ang loob mo sa pinili mo'
      ],
      guideTitle: 'Gabay: Ano ang titingnan sa loob at labas',
      guide: [
        '**Kisame at pader**: may bakas ba ng tulo, amag, o bitak?',
        '**Tubig**: buksan ang gripo, tingnan ang lakas at kulay, at ang daloy ng drain.',
        '**Kuryente**: subukan ang mga outlet at switch, at tingnan ang breaker.',
        '**Pinto at bintana**: sumasara ba nang maayos at may sira ba ang kandado?',
        '**Paligid**: saan dumadaloy ang ulan, may baha ba, at ano ang ingay at daan sa labas?'
      ],
      guideNumbered: false,
      closing: ['Isulat mo ang mga napansin mo at **itanong lahat bago ka mag-decide**. Kasama mo ako sa pagtatanong.'],
      cta: 'Mag-book ng viewing',
      ctaSubject: 'Request para sa viewing',
      ps: ''
    },

    { // x7: Day 17 (warm)
      phase: 'warm',
      subject: 'Mula reservation hanggang turnover: ano ang susunod?',
      pre: 'Para alam mo ang susunod na hakbang at hindi ka nagtataka sa bawat yugto.',
      headline: 'Mas panatag kapag malinaw ang proseso.',
      intro: [
        'Maraming buyer ang kinakabahan hindi dahil sa pera, kundi dahil **hindi nila alam ang mga hakbang** mula simula hanggang turnover.',
        'Kaya heto ang karaniwang daloy. Tandaan na nag-iiba ang eksaktong proseso at oras depende sa proyekto at financing.'
      ],
      painTitle: 'Kapag hindi malinaw ang proseso',
      pains: [
        'Hindi alam kung **ano ang susunod** at kailan',
        'Nagtatagal ang paghihintay at **walang update**',
        'May kulang na dokumento na **huli nang nalaman**'
      ],
      benTitle: 'Kapag malinaw ang mapa',
      bens: [
        'Alam mo ang **bawat yugto** at ang kailangan sa bawat isa',
        'Mas **handa** sa mga dokumento at bayad',
        'Mas **kampante** habang naghihintay'
      ],
      guideTitle: 'Gabay: Karaniwang daloy ng proseso',
      guide: [
        '**Reservation** at paglagda ng paunang kasunduan.',
        '**Pagsumite ng mga dokumento** para sa financing.',
        '**Pag-apruba o pagsusuri** ng financing.',
        '**Kontrata at down payment** ayon sa napagkasunduang plano.',
        '**Pagkumpleto at inspeksyon** ng bahay.',
        '**Turnover** at paglipat sa bahay.'
      ],
      guideNumbered: true,
      closing: ['Hingin mo ang **nakasulat na timeline** bago mag-commit. Ipapaliwanag ko ang eksaktong proseso para sa napili mong option.'],
      cta: 'Ipaliwanag ang buong proseso',
      ctaSubject: 'Ipaliwanag ang buong proseso',
      ps: ''
    },

    { // x8: Day 19 (warm)
      phase: 'warm',
      subject: 'Hindi lang bahay ang pinipili mo, ' + first + '. Komunidad din.',
      pre: 'Ang pamumuhay sa paligid ay kasinghalaga ng bahay mismo.',
      headline: 'Bahay at komunidad ang pinagpapasyahan mo.',
      intro: [
        'Maganda ang bahay, pero kung **hindi komportable ang paligid**, mahirap magtagal.',
        'Kaya bago mag-decide, tingnan din natin ang komunidad na titirhan ng pamilya mo.'
      ],
      painTitle: 'Mga problemang hindi napag-usapan agad',
      pains: [
        '**Mataas na dues** pero hindi malinaw kung saan napupunta',
        'Hindi pala **ligtas o tahimik** ang lugar sa gabi',
        'May **alituntuning hindi mo alam** tungkol sa parking, alagang hayop, o pagpapaayos'
      ],
      benTitle: 'Kapag natanong mo na ang lahat',
      bens: [
        'Walang **sorpresa** pagkatapos lumipat',
        'Mas **komportable** ang pamilya sa pang-araw-araw',
        'Mas **sulit** ang bayad mo sa buwanang dues'
      ],
      guideTitle: 'Gabay: Mga tanong tungkol sa komunidad',
      guide: [
        'Magkano ang **association dues** at anong serbisyo ang kasama?',
        'Ano ang **seguridad** at paano ang pagpasok at paglabas?',
        'Ano ang mga **alituntunin** sa parking, alagang hayop, at pag-aayos ng bahay?',
        'Gaano kalayo ang **tindahan, paaralan, at ospital**?',
        'Subukang **bumisita sa umaga at gabi** para makita ang aktwal na kalagayan.'
      ],
      guideNumbered: false,
      closing: ['Ipapaliwanag ko ang mga ito at **sasamahan kitang magtanong**, para buo ang larawan bago ka magdesisyon.'],
      cta: 'Itanong ang tungkol sa komunidad',
      ctaSubject: 'Mga tanong tungkol sa komunidad',
      ps: ''
    },

    { // x9: Day 20 (warm)
      phase: 'warm',
      subject: 'Tatlong numero lang ang kailangan ko sa iyo, ' + first,
      pre: 'I-reply ang tatlong numerong ito at ako na ang gagawa ng sample computation.',
      headline: 'Tatlong numero lang, at makakagawa na tayo ng computation.',
      intro: [
        'Hindi mo kailangang isulat ang buong kuwento mo. **Tatlong numero lang** ang kailangan ko para makagawa ng sample computation na bagay sa iyo.' + dpLine + planLine
      ],
      painTitle: 'Bakit mahalaga ang mga numerong ito',
      pains: [
        'Kung wala ito, **hula lang** ang computation',
        'Ang hula ay maaaring **sobra o kulang** sa totoo mong kaya',
        'Mahirap magdesisyon kapag **malabo ang numero**'
      ],
      benTitle: 'Ano ang makukuha mo',
      bens: [
        'Sample computation na **akma sa budget mo**',
        '**Malinaw** na down payment, monthly, at total cash-out',
        '**Walang obligasyon** at walang pressure'
      ],
      guideTitle: 'Gabay: Ang 3 numerong i-reply sa akin',
      guide: [
        '**Buwanang hulog** na komportable sa iyo.',
        '**Halagang kaya mong ilabas** sa unang bayad o kada buwan para sa down payment.',
        '**Lokasyon at uri** ng bahay na gusto mo.'
      ],
      guideNumbered: true,
      closing: ['Isang reply lang ang kailangan. Ako na ang gagawa ng iba.'],
      cta: 'I-reply ang 3 numero ko',
      ctaSubject: 'Ang 3 numero ko',
      ps: ''
    },

    { // x10: Day 22 (hot)
      phase: 'hot',
      subject: 'Ano ang pinakamabigat na tanong mo ngayon, ' + first + '?',
      pre: 'Sumagot ka sa isang linya at ako ang bahala sa iba.',
      headline: 'Ano pa ang nagpapabigat sa desisyon mo?',
      intro: concernIntro,
      painTitle: 'Kapag hindi naitatanong ang duda',
      pains: [
        'Nananatiling **nakabinbin** ang desisyon',
        'Nabubuo ang **maling akala** dahil walang sumasagot',
        'Lumilipas ang **mga linggo** na walang pagbabago'
      ],
      benTitle: 'Kapag natanong mo na',
      bens: [
        'May **tapat na sagot** ka sa loob ng isang usapan',
        'Alam mo kung **may solusyon** o kung hindi bagay sa iyo',
        'Mas **madali** ang susunod na hakbang'
      ],
      guideTitle: 'Gabay: Pumili ng isa at i-reply',
      guide: [
        '**Budget**: baka hindi kaya ng hulog.',
        '**Loan**: baka hindi ma-approve.',
        '**Down payment**: baka kulang ang unang bayad.',
        '**Lokasyon**: baka hindi bagay sa trabaho o paaralan.',
        '**Tiwala**: gusto kong makatiyak sa developer at proseso.',
        '**Iba pa**: sabihin mo lang sa sarili mong salita.'
      ],
      guideNumbered: false,
      closing: ['Isang linya lang ang kailangan. **Sasagutin kita nang diretso at tapat.**'],
      cta: 'I-reply ang tanong ko',
      ctaSubject: 'Pinakamalaking tanong ko',
      ps: ''
    },

    { // x11: Day 24 (hot)
      phase: 'hot',
      subject: 'Dalawang posibleng direksyon makalipas ang isang taon',
      pre: 'Halimbawa lang ito. Sa alin ka mas gustong mapunta?',
      headline: 'Makalipas ang isang taon, saan mo gustong mapunta?',
      intro: [
        'Heto ang isang **halimbawa** (hindi ito kuwento ng totoong tao). Ipagpalagay nating dalawang pamilya ang may parehong sitwasyon ngayon.',
        '**Ang unang pamilya** ay nagpatuloy sa paghihintay ng tamang panahon. Isang taon pagkatapos, ganoon pa rin ang renta, ganoon pa rin ang tanong, at **wala pang malinaw na numero**.',
        '**Ang pangalawang pamilya** ay nagpa-compute, nag-viewing, at naghanda ng papeles. Isang taon pagkatapos, **alam na nila ang kanilang pagpipilian**, anuman ang naging desisyon.'
      ],
      painTitle: 'Ang kapalit ng "mamaya na lang"',
      pains: [
        'Parehong **gastos at tanong**, walang pagbabago',
        'Walang **numerong hawak**, kaya mahirap magdesisyon',
        'Mas **maraming buwang lumipas** nang walang aksyon'
      ],
      benTitle: 'Ang pagkakaiba ng nagsimula na',
      bens: [
        'May **malinaw na impormasyon** at mga numero',
        'Alam kung **kaya na ba** o ano pa ang dapat ayusin',
        'May **kontrol** sa susunod na hakbang'
      ],
      closing: ['Hindi ko sinasabing dapat kang bumili ngayon. Ang sinasabi ko, **magsimula ka nang makakuha ng malinaw na sagot**, at doon ka magdesisyon.'],
      cta: 'Gusto kong magsimula ngayon',
      ctaSubject: 'Gusto kong magsimula ngayon',
      ps: ''
    },

    { // x12: Day 26 (hot)
      phase: 'hot',
      subject: 'Sampung minuto lang. Ano ang mangyayari sa call?',
      pre: 'Walang pressure. Ito ang eksaktong takbo ng usapan.',
      headline: 'Sampung minuto lang, at mas malinaw na ang susunod na hakbang.',
      intro: [
        'Alam kong abala ka, ' + first + '. Kaya heto ang tapat na paliwanag kung ano ang mangyayari sa maikling call, para hindi ka na mag-alinlangan.',
        'Hindi ito sales pitch na magpipilit sa iyo. Usapan ito para **magkaroon ka ng malinaw na larawan**.'
      ],
      painTitle: 'Mga dahilan kung bakit hindi nagpapa-call',
      pains: [
        '"Baka pilitin akong bumili."',
        '"Baka masayang lang ang oras ko."',
        '"Hindi pa ako handa."'
      ],
      benTitle: 'Ano ang makukuha mo sa 10 minuto',
      bens: [
        '**Tapat na paliwanag** ng numbers',
        '**Malinaw na susunod na hakbang**, o malinaw na hindi pa panahon',
        '**Walang obligasyon** at walang bayad'
      ],
      guideTitle: 'Gabay: Ganito ang takbo ng call',
      guide: [
        'Itatanong ko ang **tatlong numero** (hulog, down payment, lokasyon).',
        'Magbibigay ako ng **tantiyang sample computation**.',
        'Sasabihin ko nang tapat kung **bagay ba o hindi** ang option sa iyo.',
        'Ikaw ang magpapasya kung **magpapatuloy o hihinto**.'
      ],
      guideNumbered: true,
      closing: ['I-reply ang pinakamagandang oras mo at ako ang tatawag.'],
      cta: 'Mag-book ng 10-minutong call',
      ctaSubject: 'Mag-book ng 10-minutong call',
      ps: ''
    },

    { // x13: Day 27 (hot)
      phase: 'hot',
      subject: 'Kung "oo" ka na, ito ang susunod na 4 na hakbang',
      pre: 'Simple at malinaw. Walang mawawala sa iyo habang hindi ka pa nagre-reserve.',
      headline: 'Apat na malinaw na hakbang mula "oo" hanggang aksyon.',
      intro: [
        'Kung nakarating ka na sa puntong **handa ka nang kumilos**, ' + first + ', heto ang eksaktong landas, para hindi ka malito.',
        'Karamihan sa mga hakbang na ito ay **walang obligasyon** hanggang sa maging desidido ka.'
      ],
      painTitle: 'Ang nagpapatagal sa desisyon',
      pains: [
        'Hindi alam kung **saan magsisimula**',
        'Takot na ang unang hakbang ay **may kaakibat na obligasyon**',
        'Hindi alam kung **ano ang mauuna**'
      ],
      benTitle: 'Kapag malinaw ang landas',
      bens: [
        'Alam mo kung **ano ang gagawin ngayon** at sa susunod',
        'Kontrolado mo ang **bilis** ng proseso',
        'Hindi ka **nagmamadali** sa mga bagay na hindi pa malinaw'
      ],
      guideTitle: 'Gabay: Ang 4 na hakbang',
      guide: [
        '**Sample computation**: ihanda natin ang numero para sa budget mo.',
        '**Viewing**: tingnan mo mismo ang bahay, onsite o online.',
        '**Dokumento**: simulan nating ihanda ang mga papeles.',
        '**Reservation at financing**: kapag handa ka na at klaro na ang lahat.'
      ],
      guideNumbered: true,
      closing: ['Mag-reply ng **"SIMULAN"** at gagawin ko ang unang hakbang para sa iyo.'],
      cta: 'Mag-reply ng "SIMULAN"',
      ctaSubject: 'SIMULAN',
      ps: ''
    },

    { // x14: Day 29 (hot)
      phase: 'hot',
      subject: 'Bago matapos ang 30 araw: paano mo ako makakausap, ' + first,
      pre: 'Tatlong madaling paraan. Pumili ng pinakakomportable sa iyo.',
      headline: 'Isang hakbang na lang, ' + first + '.',
      intro: [
        'Halos isang buwan na tayong nag-uusap sa email. Hindi ko alam kung nasaan ka na sa desisyon mo, pero gusto kong **siguraduhing alam mo kung paano ako maaabot**.',
        'Kung may natirang tanong, kahit maliit lang, **mas mabuting itanong na ngayon** kaysa dalhin pa.'
      ],
      painTitle: 'Ang madalas mangyari sa dulo',
      pains: [
        'Nag-iiwan ng tanong at **hindi na nababalikan**',
        'Naghihintay ng **perpektong sandali** na hindi dumarating',
        'Nauuwi sa **wala** ang buwan ng pagtitipon ng impormasyon'
      ],
      benTitle: 'Tatlong madaling paraan para makausap ako',
      bens: [
        '**I-reply ang email na ito** kahit isang linya lang',
        '**I-text o tawagan** ako sa ' + CONFIG.AGENT_PHONE,
        '**Magpadala ng petsa at oras** at ako ang mag-aadjust'
      ],
      benNumbered: true,
      closing: ['Handa akong sagutin ang anumang tanong mo, kahit hindi ka pa handang mag-reserve. **Walang pressure at walang obligasyon.**'],
      cta: 'Mag-reply ng petsa at oras',
      ctaSubject: 'Preferred date and time',
      ps: ''
    }
  ];
}

/** Pinagsasama ang 15 base at 15 extra na emails para sa isang email kada araw (Day 1 hanggang Day 30). */
function sequence_(first, r) {
  var b = baseSequence_(first, r);
  var x = extraSequence_(first, r);
  var order = [
    ['b', 0], ['b', 1], ['x', 0], ['b', 2], ['x', 1], ['b', 3], ['x', 2], ['b', 4], ['x', 3], ['x', 4],     // Day 1-10 COLD
    ['b', 5], ['b', 6], ['x', 5], ['b', 7], ['x', 6], ['b', 8], ['x', 7], ['b', 9], ['x', 8], ['x', 9],     // Day 11-20 WARM
    ['b', 10], ['x', 10], ['b', 11], ['x', 11], ['b', 12], ['x', 12], ['x', 13], ['b', 13], ['x', 14], ['b', 14] // Day 21-30 HOT
  ];
  return order.map(function (o) { return o[0] === 'b' ? b[o[1]] : x[o[1]]; });
}

/* ----------------------------------------------------------- email render */

/** Kinukuha ang email image (footer) mula sa Drive. Kapag pumalya, ituloy ang email nang walang image. */
function heroImageBlob_(index) {
  var id = String(CONFIG.EMAIL_IMAGE_FILE_ID || '').trim();
  if (!id || CONFIG.EMAIL_IMAGE_EMAILS.indexOf(index) === -1) return null;
  try {
    return DriveApp.getFileById(id).getBlob().setName('hero');
  } catch (err) {
    Logger.log('Hero image not loaded: ' + err);
    return null;
  }
}

function computationPdfBlob_() {
  var id = String(CONFIG.COMPUTATION_PDF_FILE_ID || '').trim();
  if (!id) return null;
  try {
    return DriveApp.getFileById(id).getBlob().setName(CONFIG.COMPUTATION_PDF_NAME || 'Alara Village House Model Computations.pdf');
  } catch (err) {
    Logger.log('Computation PDF not attached: ' + err);
    return null;
  }
}
function computationPdfUrl_() {
  var id = String(CONFIG.COMPUTATION_PDF_FILE_ID || '').trim();
  return id ? 'https://drive.google.com/file/d/' + encodeURIComponent(id) + '/view?usp=sharing' : '';
}
function rich_(s) { return esc_(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'); }
function plain_(s) { return String(s).replace(/\*\*(.+?)\*\*/g, '$1'); }

function buildEmail_(index, first, token, r) {
  var unsub = unsubUrl_(token);
  var c = sequence_(first, r)[index];
  var heroBlob = heroImageBlob_(index);
  var pdfBlob = computationPdfBlob_();
  var pdfUrl = computationPdfUrl_();
  var imgFull = String(CONFIG.EMAIL_IMAGE_WIDTH).toLowerCase() === 'full';
  var imgW = imgFull ? 556 : Math.max(80, Math.min(556, parseInt(CONFIG.EMAIL_IMAGE_WIDTH, 10) || 260));
  var heroHtml = heroBlob
    ? '<div class="fimg" style="padding:28px 32px 6px;text-align:center">' +
      '<img src="cid:heroImg" alt="' + esc_(CONFIG.EMAIL_IMAGE_ALT) + '" width="' + imgW + '" style="display:block;margin:0 auto;width:' + (imgFull ? '100%' : imgW + 'px') + ';max-width:100%;height:auto;border:0;outline:none;border-radius:8px">' +
      '</div>'
    : '';
  var leadId = r ? String(r[COL['Lead ID']] || '') : '';
  var GREEN = '#2E4D3E', GOLD = '#B8935A', CREAM = '#F2EFE9', INK = '#243129';
  var telDigits = String(CONFIG.AGENT_PHONE).replace(/[^\d+]/g, '');
  var mailto = 'mailto:' + CONFIG.AGENT_EMAIL + '?subject=' + encodeURIComponent(c.ctaSubject + (leadId ? ' (' + leadId + ')' : ''));

  function listRows(items, symbol, color, numbered) {
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">' +
      items.map(function (t, i) {
        return '<tr><td width="28" valign="top" style="padding:6px 0;color:' + color + ';font-weight:bold;font-size:16px">' + (numbered ? (i + 1) + '.' : symbol) + '</td>' +
          '<td valign="top" style="padding:6px 0;font-size:16px;line-height:1.55;color:' + INK + '">' + rich_(t) + '</td></tr>';
      }).join('') + '</table>';
  }

  var concern = concernNote_(r);
  var summary = '';
  if (c.showSummary && r) {
    var answers = [
      ['Main reason', r[COL['Main Reason']]], ['Property type', r[COL['Property Type']]],
      ['Preferred location', r[COL['Preferred Location']]], ['Monthly down payment', r[COL['Monthly Down Payment']]],
      ['Payment plan', r[COL['Financing Plan']]], ['Biggest concern', r[COL['Biggest Concern']]]
    ];
    summary = '<div class="box" style="margin:26px 0;padding:20px;background:#FFFFFF;border:1px solid #E3DCCB;border-top:3px solid ' + GOLD + ';border-radius:10px">' +
      '<p style="margin:0 0 10px;color:' + GREEN + ';font-size:12px;letter-spacing:2px;text-transform:uppercase"><b>Buod ng consultation mo</b></p>' +
      answers.map(function (x) { return '<div style="padding:9px 0;border-top:1px solid #EEE8D9;font-size:15px"><span style="color:#7A8279">' + esc_(x[0]) + '</span><br><b style="color:' + INK + '">' + esc_(x[1] || 'Hindi pa nabanggit') + '</b></div>'; }).join('') +
      '</div>';
    if (concern) summary += '<p style="margin:0 0 6px;font-size:16px;font-style:italic;color:' + GREEN + '">' + rich_(concern) + '</p>';
  }

  var guideHtml = '';
  var pdfHtml = pdfUrl
    ? '<div class="box pdf-box" style="margin:24px 0;padding:18px 20px;background:#F4F7F2;border:1px solid #C9D8C7;border-radius:10px">' +
      '<p style="margin:0 0 7px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:' + GREEN + '"><b>Kalakip sa email na ito</b></p>' +
      '<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:' + INK + '">Makikita mo sa PDF ang sample computations para sa lahat ng house models. Maaari mo rin itong buksan online:</p>' +
      '<a href="' + esc_(pdfUrl) + '" style="display:inline-block;background:' + GREEN + ';color:#FFFFFF;text-decoration:none;font-weight:bold;font-size:14px;padding:12px 16px;border-radius:7px">Tingnan ang house model computations &rarr;</a>' +
      '</div>'
    : '';
  if (c.guide && c.guide.length) {
    guideHtml = '<div class="box" style="margin:22px 0;padding:18px 20px;background:#FFF8EA;border:1px solid #EBD9B4;border-left:4px solid ' + GOLD + ';border-radius:6px">' +
      '<p style="margin:0 0 8px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#8A6A33"><b>' + esc_(c.guideTitle || 'Gabay') + '</b></p>' +
      listRows(c.guide, '•', GOLD, !!c.guideNumbered) +
      '</div>';
  }

  var html =
    '<!DOCTYPE html><html lang="fil"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="x-apple-disable-message-reformatting">' +
    '<title>' + esc_(c.subject) + '</title>' +
    '<style>' +
      'body{margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}' +
      'img{-ms-interpolation-mode:bicubic}' +
      'a{word-break:break-word}' +
      '@media only screen and (max-width:640px){' +
        '.outer{padding:0 !important}' +
        '.card{border-radius:0 !important;width:100% !important}' +
        '.hd{padding:24px 18px 22px !important}' +
        '.h1{font-size:25px !important;line-height:1.25 !important}' +
        '.pad{padding:24px 18px !important}' +
        '.box{padding:16px 14px !important}' +
        '.pdf-box a{display:block !important;text-align:center !important;line-height:1.35 !important}' +
        '.btn{width:100% !important}' +
        '.btn a{display:block !important;text-align:center !important;padding:16px 12px !important}' +
        '.ft{padding:18px !important}' +
        '.fimg{padding:22px 18px 4px !important}' +
      '}' +
    '</style></head>' +
    '<body style="margin:0;padding:0;background:' + CREAM + '">' +
    '<div class="outer" style="margin:0;background:' + CREAM + ';padding:30px 12px;font-family:Arial,Helvetica,sans-serif;color:' + INK + ';line-height:1.65">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px">' + esc_(c.pre) + '</div>' +
    '<div class="card" style="max-width:620px;margin:0 auto;background:#FFFFFF;border-radius:14px;overflow:hidden;box-shadow:0 12px 34px rgba(32,56,46,.10)">' +
      '<div style="height:5px;background:' + GOLD + '"></div>' +
      '<div class="hd" style="padding:30px 32px 28px;background:' + GREEN + ';color:#FFFFFF">' +
        '<div style="font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#D9BC8A;font-weight:bold">' + esc_(CONFIG.BRAND) + ' &nbsp;·&nbsp; Alara Village &nbsp;·&nbsp; Araw ' + (index + 1) + ' ng ' + CONFIG.SEQUENCE_DAYS.length + '</div>' +
        '<div class="h1" style="font-family:Georgia,\'Times New Roman\',serif;font-size:29px;line-height:1.22;margin-top:12px">' + esc_(c.headline) + '</div>' +
      '</div>' +
      '<div class="pad" style="padding:32px">' +
        '<p style="margin:0 0 16px;font-size:17px">Hi ' + esc_(first) + ',</p>' +
        c.intro.map(function (p) { return '<p style="margin:0 0 16px;font-size:17px;line-height:1.65">' + rich_(p) + '</p>'; }).join('') +
        '<div class="box" style="margin:22px 0;padding:18px 20px;background:#FBF3EC;border-left:4px solid #C0714F;border-radius:6px">' +
          '<p style="margin:0 0 8px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#A4553A"><b>' + esc_(c.painTitle) + '</b></p>' +
          listRows(c.pains, '✕', '#C0714F', false) +
        '</div>' +
        '<div class="box" style="margin:22px 0;padding:18px 20px;background:#EAF3E6;border-left:4px solid ' + GREEN + ';border-radius:6px">' +
          '<p style="margin:0 0 8px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:' + GREEN + '"><b>' + esc_(c.benTitle) + '</b></p>' +
          listRows(c.bens, '✓', GREEN, !!c.benNumbered) +
        '</div>' +
        guideHtml +
        summary +
        pdfHtml +
        c.closing.map(function (p) { return '<p style="margin:16px 0;font-size:17px;line-height:1.65">' + rich_(p) + '</p>'; }).join('') +
        (index === 0 ? '<div class="box" style="margin:22px 0;padding:16px 20px;background:' + CREAM + ';border-radius:8px;font-size:15px"><b style="color:' + GREEN + '">Ano ang susunod na hakbang?</b><br>Rerepasuhin ko ang mga sagot mo at personal akong magre-reply sa loob ng 24 oras. May idadagdag ka? I-reply mo lang ang email na ito.</div>' : '') +
        '<table class="btn" role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 10px"><tr><td style="background:' + GREEN + ';border-radius:8px;text-align:center">' +
          '<a href="' + esc_(mailto) + '" style="display:inline-block;padding:15px 28px;color:#FFFFFF;text-decoration:none;font-weight:bold;font-size:16px;border-bottom:3px solid ' + GOLD + ';border-radius:8px">' + esc_(c.cta) + ' &rarr;</a>' +
        '</td></tr></table>' +
        '<table class="btn" role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 6px"><tr><td style="border:2px solid ' + GREEN + ';border-radius:8px;text-align:center">' +
          '<a href="tel:' + esc_(telDigits) + '" style="display:inline-block;padding:12px 24px;color:' + GREEN + ';text-decoration:none;font-weight:bold;font-size:15px">Tawagan si ' + esc_(CONFIG.AGENT_NAME.split(' ')[0]) + ': ' + esc_(CONFIG.AGENT_PHONE) + '</a>' +
        '</td></tr></table>' +
        (pageUrl_() ? '<p style="margin:10px 0 0;font-size:14px"><a style="color:' + GREEN + '" href="' + esc_(pageUrl_()) + '">Bumalik sa consultation page</a></p>' : '') +
        (c.ps ? '<p style="margin:18px 0 0;font-size:15px;color:#66736B"><b>P.S.</b> ' + rich_(c.ps) + '</p>' : '') +
        '<div style="margin-top:30px;padding-top:20px;border-top:1px solid #EEE8D9">' +
          '<p style="margin:0;font-size:15px">Taos-pusong pagbati,<br><b style="color:' + GREEN + ';font-size:17px">' + esc_(CONFIG.AGENT_NAME) + '</b><br><span style="color:#66736B">' + esc_(CONFIG.BRAND) + '</span><br>' +
          esc_(CONFIG.AGENT_PHONE) + ' · <a style="color:' + GREEN + '" href="mailto:' + esc_(CONFIG.AGENT_EMAIL) + '">' + esc_(CONFIG.AGENT_EMAIL) + '</a></p>' +
          '<p style="font-size:14px;margin:12px 0 0"><a style="color:' + GREEN + ';font-weight:bold" href="' + esc_(CONFIG.FACEBOOK_URL) + '">Bisitahin ang Facebook page</a></p>' +
        '</div>' +
      '</div>' +
      '<div style="background:#20382E">' +
        heroHtml +
        '<div class="ft" style="padding:18px 32px;background:#20382E;color:#DDE9DF;font-size:12px;line-height:1.6">' +
          'Natanggap mo ang email na ito dahil nag-inquire ka tungkol sa Alara Village. <a style="color:#D9BC8A" href="' + esc_(unsub) + '">Mag-unsubscribe</a> anumang oras. ' +
          'Ang presyo, specifications, at availability ay subject to confirmation. Hindi garantisado ang financing approval.' +
        '</div>' +
      '</div>' +
    '</div></div></body></html>';

  // Plain-text version (mula sa parehong content, may unsubscribe link)
  var t = [];
  t.push('[Araw ' + (index + 1) + ' ng ' + CONFIG.SEQUENCE_DAYS.length + ']', '', 'Kumusta, ' + first + ',', '');
  c.intro.forEach(function (p) { t.push(plain_(p), ''); });
  t.push(c.painTitle.toUpperCase());
  c.pains.forEach(function (p) { t.push('x ' + plain_(p)); });
  t.push('', c.benTitle.toUpperCase());
  c.bens.forEach(function (p, i) { t.push((c.benNumbered ? (i + 1) + '. ' : '+ ') + plain_(p)); });
  t.push('');
  if (c.guide && c.guide.length) {
    t.push((c.guideTitle || 'GABAY').toUpperCase());
    c.guide.forEach(function (p, i) { t.push((c.guideNumbered ? (i + 1) + '. ' : '- ') + plain_(p)); });
    t.push('');
  }
  if (c.showSummary && concern) t.push(plain_(concern), '');
  c.closing.forEach(function (p) { t.push(plain_(p), ''); });
  if (index === 0) t.push('Ano ang susunod? Rerepasuhin ko ang mga sagot mo at personal akong magre-reply sa loob ng 24 oras.', '');
  t.push(c.cta + ': i-reply ang email na ito o tawagan ako sa ' + CONFIG.AGENT_PHONE + '.', '');
  if (pdfUrl) t.push('Kalakip: ' + CONFIG.COMPUTATION_PDF_NAME, 'Buksan ang computations: ' + pdfUrl, '');
  if (c.ps) t.push('P.S. ' + plain_(c.ps), '');
  t.push('Taos-pusong pagbati,', CONFIG.AGENT_NAME, CONFIG.BRAND, CONFIG.AGENT_PHONE + ' · ' + CONFIG.AGENT_EMAIL, '',
    'Mag-unsubscribe: ' + unsub);

  return { subject: c.subject, phase: c.phase, html: html, text: t.join('\n'), images: heroBlob ? { heroImg: heroBlob } : null, pdf: pdfBlob };
}

/* --------------------------------------------------------------- unsubscribe */

function unsubscribePage_(token) {
  var msg = 'This unsubscribe link is not valid.';
  var sheet = getSheet_();
  var last = sheet.getLastRow();
  if (last >= 2 && token) {
    var tokens = sheet.getRange(2, COL['Unsub Token'] + 1, last - 1, 1).getValues();
    for (var i = 0; i < tokens.length; i++) {
      if (tokens[i][0] === token) {
        sheet.getRange(i + 2, COL['Unsubscribed'] + 1).setValue(new Date());
        msg = 'You have been unsubscribed. You will not receive further marketing emails from this inquiry.';
        break;
      }
    }
  }
  return HtmlService.createHtmlOutput('<div style="font-family:Arial,sans-serif;max-width:480px;margin:4rem auto;padding:0 1rem;color:#14213D"><h2 style="color:#0B3D91">Hanap Bahay Advisor</h2><p>' + esc_(msg) + '</p></div>')
    .setTitle('Unsubscribe').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ------------------------------------------------------------------ helpers */

function esc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* --------------------------------------------------------- sheet generator */

/**
 * Creates the Sheets needed by the lead system automatically.
 * Safe to run repeatedly: it reuses existing tabs and does not duplicate them.
 */
function generateSheets() {
  var ss = getSpreadsheet_();
  var leads = getSheet_();
  var dashboard = ss.getSheetByName('Dashboard');
  var createdDashboard = false;

  if (!dashboard) {
    dashboard = ss.insertSheet('Dashboard', 0);
    createdDashboard = true;
  }

  // Only seed the dashboard if it is new or empty, so a custom dashboard is not overwritten.
  if (createdDashboard || dashboard.getLastRow() === 0) {
    var leadName = CONFIG.SHEET_NAME.replace(/'/g, "''");
    dashboard.getRange('A1:F1').merge().setValue('Hanap Bahay Advisor — Lead Dashboard');
    dashboard.getRange('A1:F1').setBackground('#2E4D3E').setFontColor('#FFFFFF').setFontSize(16).setFontWeight('bold');
    dashboard.getRange('A2:F2').merge().setValue('Live summary from the Leads sheet. Refreshes automatically when the sheet recalculates.');
    dashboard.getRange('A2:F2').setFontColor('#66736B').setFontStyle('italic');

    dashboard.getRange('A4:B4').setValues([['Metric', 'Value']]).setBackground('#BBDDAA').setFontWeight('bold');
    dashboard.getRange('A5:B8').setValues([
      ['Total leads', "=COUNTA('" + leadName + "'!B2:B)"],
      ['New inquiries', "=COUNTIF('" + leadName + "'!P2:P,\"New Inquiry\")"],
      ['Consultations scheduled', "=COUNTIF('" + leadName + "'!P2:P,\"Consultation Scheduled\")"],
      ['Unsubscribed', "=COUNTIF('" + leadName + "'!T2:T,\"<>\")"]
    ]);
    dashboard.getRange('A11:B11').setValues([['Status', 'Count']]).setBackground('#BBDDAA').setFontWeight('bold');
    dashboard.getRange('A12:A21').setValues(STATUSES.map(function (x) { return [x]; }));
    dashboard.getRange('B12:B21').setFormulas(STATUSES.map(function (x) {
      return ["=COUNTIF('" + leadName + "'!P2:P,\"" + x.replace(/"/g, '""') + "\")"];
    }));
    dashboard.getRange('D4:F4').merge().setValue('Quick links').setBackground('#BBDDAA').setFontWeight('bold');
    dashboard.getRange('D5:F6').merge().setValue('Open the Leads tab to review contact details, consultation answers, email status, and next actions.');
    dashboard.getRange('D8:F8').merge().setValue('Facebook page').setBackground('#BBDDAA').setFontWeight('bold');
    dashboard.getRange('D9:F9').merge().setValue(CONFIG.FACEBOOK_URL);
    dashboard.setFrozenRows(4);
    dashboard.setColumnWidth(1, 230);
    dashboard.setColumnWidth(2, 110);
    dashboard.setColumnWidths(4, 3, 170);
    dashboard.getRange('A1:F21').setVerticalAlignment('middle');
    dashboard.getRange('A4:B21').setBorder(true, true, true, true, true, true, '#D9E4D4', SpreadsheetApp.BorderStyle.SOLID);
  }

  leads.setFrozenRows(1);
  leads.autoResizeColumns(1, Math.min(HEADERS.length, leads.getMaxColumns()));
  return { leads: leads.getName(), dashboard: dashboard.getName(), createdDashboard: createdDashboard };
}

/* -------------------------------------------------------------------- setup */

/** Patakbuhin ito ISANG BESES mula sa editor. Gumagawa ng sheet tab, status dropdown at daily trigger. */
function setup() {
  generateSheets();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDueEmails') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendDueEmails').timeBased().everyDays(1).atHour(CONFIG.SEND_HOUR).inTimezone('Asia/Manila').create();
  Logger.log('Setup complete. Palitan ang NOTIFY_EMAIL at AGENT_* sa CONFIG, tapos mag-deploy ng web app.');
}

/** Ipakita sa Execution log ang kasalukuyang Web App URL (kopyahin ito sa CONFIG.WEB_APP_URL para gumana ang unsubscribe). */
function showWebAppUrl() {
  Logger.log('Web App URL: ' + (ScriptApp.getService().getUrl() || '(wala pang deployment)'));
}

/* -------------------------------------------------------------------- tests */

/** Test 1: nagpapasok ng pekeng lead gamit ang TEST_EMAIL. Burahin ang test row pagkatapos. */
function testSubmit() {
  var res = submitLead({
    fullName: 'Test Lead', email: CONFIG.TEST_EMAIL, mobile: '09171234567', monthly: '₱9M–₱10M', availability: 'Weekdays after 6PM', question: 'Test submission',
    buyerType: 'First-time buyer', mainReason: 'First home', propertyType: 'House and Lot', preferredLocation: 'Cavite',
    monthlyDownPayment: '₱10,000–₱20,000', financingPlan: 'Pag-IBIG', biggestConcern: 'Budget', concernOther: '',
    location: 'Imus, Cavite', requestType: 'Consultation + sample computation', consentToContact: true,
    consentText: 'TEST consent', source: 'apps-script-test'
  });
  Logger.log(JSON.stringify(res));
}

/** Test 2: ipinapadala agad ang LAHAT ng 10 emails sa TEST_EMAIL para ma-preview ang design (buksan sa phone at desktop). Hindi nagsa-save sa sheet. */
function previewAllEmails() {
  var fake = new Array(HEADERS.length).fill('');
  fake[COL['Lead ID']] = 'AV-PREVIEW';
  fake[COL['Main Reason']] = 'First home';
  fake[COL['Property Type']] = 'House and Lot';
  fake[COL['Preferred Location']] = 'Cavite';
  fake[COL['Monthly Down Payment']] = '₱10,000–₱20,000';
  fake[COL['Financing Plan']] = 'Pag-IBIG';
  fake[COL['Biggest Concern']] = 'Budget';
  var total = CONFIG.SEQUENCE_DAYS.length;
  for (var i = 0; i < total; i++) {
    var m = buildEmail_(i, 'DELA CRUZ', 'preview-token', fake);
    var opts = {
      to: CONFIG.TEST_EMAIL, subject: '[PREVIEW ' + (i + 1) + '/' + total + ' · Day ' + (CONFIG.SEQUENCE_DAYS[i] + 1) + ' · ' + String(m.phase || '').toUpperCase() + '] ' + m.subject, body: m.text, htmlBody: m.html,
      name: CONFIG.AGENT_NAME + ' | ' + CONFIG.BRAND, replyTo: CONFIG.AGENT_EMAIL
    };
    if (m.images) opts.inlineImages = m.images;
    if (m.pdf) opts.attachments = [m.pdf];
    MailApp.sendEmail(opts);
  }
  Logger.log('Sent ' + total + ' preview emails to ' + CONFIG.TEST_EMAIL);
}

/** Patakbuhin sa editor kapag may problema. Tingnan ang Execution log sa baba. Burahin ang "Diag Test" row pagkatapos. */
function diagnose() {
  try { Logger.log('Spreadsheet OK: ' + getSpreadsheet_().getName()); } catch (e) { Logger.log('SPREADSHEET PROBLEM: ' + e.message); }
  try { Logger.log('Leads sheet OK, rows: ' + getSheet_().getLastRow()); } catch (e) { Logger.log('SHEET PROBLEM: ' + e.message); }
  try { Logger.log('Mail quota left: ' + MailApp.getRemainingDailyQuota()); } catch (e) { Logger.log('MAIL PERMISSION PROBLEM: ' + e.message); }
  try { Logger.log('Hero image OK: ' + DriveApp.getFileById(CONFIG.EMAIL_IMAGE_FILE_ID).getName()); } catch (e) { Logger.log('DRIVE PROBLEM (non-fatal): ' + e.message); }
  Logger.log(JSON.stringify(submitLead({ fullName: 'Diag Test', email: CONFIG.TEST_EMAIL, mobile: '09171234567', consentToContact: true, source: 'diagnose' })));
}


/* ------------------------------------------------------ sheet helper / repair functions */

/** Naglalagay ng status dropdown. Kapag hindi pinapayagan (Table/typed column), nilalaktawan lang, walang error. */
function applyStatusDropdown_(sheet) {
  try {
    var rule = SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(true).build();
    sheet.getRange(2, COL['Status'] + 1, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(rule);
    return true;
  } catch (err) {
    Logger.log('Status dropdown skipped: ' + err.message);
    return false;
  }
}

/** Ligtas na pagdagdag ng lead row. Pinapanatili ang leading 0 ng mobile number. Ibinabalik ang row number. */
function appendLeadRow_(sheet, row) {
  var mobile = String(row[COL['Mobile']] || '');
  var mobileCol = COL['Mobile'] + 1;

  // 1) Siguraduhing may espasyo sa ibaba at sa kanan
  if (sheet.getMaxColumns() < HEADERS.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), HEADERS.length - sheet.getMaxColumns());
  var target = sheet.getLastRow() + 1;
  if (target > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 20);

  // 2) Subukang gawing plain text ang mobile cell. Kung bawal (typed column), ituloy lang.
  try { sheet.getRange(target, mobileCol).setNumberFormat('@'); } catch (err) { Logger.log('Mobile format skipped: ' + err.message); }

  // 3) I-save ang row. appendRow muna, kung bawal ay setValues sa susunod na row.
  var rowNum;
  try {
    sheet.appendRow(row);
    rowNum = sheet.getLastRow();
  } catch (err) {
    Logger.log('appendRow failed, using setValues: ' + err.message);
    rowNum = target;
    sheet.getRange(rowNum, 1, 1, row.length).setValues([row]);
  }

  // 4) Kung nawala ang leading 0 ng mobile, ibalik bilang text
  try {
    var cell = sheet.getRange(rowNum, mobileCol);
    if (mobile && String(cell.getDisplayValue()) !== mobile) cell.setValue("'" + mobile);
  } catch (err) { Logger.log('Mobile fix skipped: ' + err.message); }
  return rowNum;
}

/**
 * Patakbuhin sa editor kapag may problema sa Leads sheet.
 * Sinusuri ang tab, headers, columns, at kung may Table (typed columns). Basahin ang Execution log.
 */
function checkLeadsSheet() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) { Logger.log('Walang tab na "' + CONFIG.SHEET_NAME + '". Patakbuhin ang setup() para gumawa.'); return; }
  var headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  var missing = HEADERS.filter(function (h) { return headers.indexOf(h) === -1; });
  var misplaced = HEADERS.filter(function (h, i) { return headers[i] !== h; });
  Logger.log('Rows: ' + sheet.getLastRow() + ' / ' + sheet.getMaxRows() + ', Columns: ' + sheet.getLastColumn() + ' / ' + sheet.getMaxColumns());
  Logger.log('Kulang na headers: ' + (missing.length ? missing.join(', ') : 'wala'));
  Logger.log('Hindi tugma ang posisyon: ' + (misplaced.length ? misplaced.join(', ') : 'wala'));
  var t1 = true, t2 = true;
  try { sheet.getRange(sheet.getMaxRows(), COL['Mobile'] + 1).setNumberFormat('@'); } catch (e) { t1 = false; Logger.log('Hindi puwedeng baguhin ang format ng Mobile: ' + e.message); }
  try { sheet.getRange(sheet.getMaxRows(), COL['Status'] + 1).setDataValidation(null); } catch (e) { t2 = false; Logger.log('Hindi puwedeng baguhin ang validation ng Status: ' + e.message); }
  if (!t1 || !t2) Logger.log('MAY TABLE ANG SHEET (typed columns). Sa Sheets: i-click ang table > Table menu > "Convert to range" kung gusto mong alisin. Gumagana pa rin ang form kahit hindi mo ito baguhin.');
  else Logger.log('Walang nakitang problema sa format ng sheet.');
}

/**
 * Ine-ayos ang mga header sa tamang pagkakasunod-sunod at nag-aayos ng Mobile format.
 * LIGTAS: hindi nagbubura ng data. Isang beses lang patakbuhin kung hindi tugma ang posisyon ng columns.
 */
function repairLeadsHeaders() {
  var sheet = getSheet_();
  var headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  var mismatch = HEADERS.some(function (h, i) { return headers[i] !== h; });
  if (!mismatch) { Logger.log('Tama na ang pagkakasunod ng headers.'); return; }
  // Gumawa ng backup tab bago baguhin ang anuman
  var ss = getSpreadsheet_();
  var backup = sheet.copyTo(ss).setName('Leads backup ' + Utilities.formatDate(new Date(), 'Asia/Manila', 'MMdd-HHmm'));
  Logger.log('Backup ginawa: ' + backup.getName());
  if (sheet.getMaxColumns() < HEADERS.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), HEADERS.length - sheet.getMaxColumns());
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold').setBackground('#2E4D3E').setFontColor('#FFFFFF');
  Logger.log('Na-update ang headers. Tingnan ang backup tab kung may data na hindi tugma sa bagong pagkakasunod.');
}
