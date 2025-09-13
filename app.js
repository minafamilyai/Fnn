// ONECHAT - v30.5
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDatabase, ref, child, set, get, push, onChildAdded, onValue, update } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const qs = new URLSearchParams(location.search);
const roomParam = (qs.get('room') || '').toUpperCase();

// DOM
const $ = s => document.querySelector(s);
const messagesEl = $('#messages');
const codeText = $('#codeText');
const linkBtn = $('#linkBtn');
const qrCanvas = $('#qrCanvas');
const exitBtn = $('#exitBtn');
const homeBtn = $('#homeBtn');

const msgInput = $('#msgInput'), sendBtn = $('#sendBtn'), fileInput = $('#fileInput'), attachBtn = $('#attachBtn');
const msgCenter = $('#msgCenter'), sendCenter = $('#sendCenter'), fileCenter = $('#fileCenter'), attachCenter = $('#attachCenter');

const MAX_MB = 15;
const isImg   = m => (m||'').startsWith('image/');
const isVideo = m => (m||'').startsWith('video/');
const isAudio = m => (m||'').startsWith('audio/');
const isCode  = s => /^[A-Z0-9]{5,7}$/i.test((s||'').trim());

let app, db, auth;
let roomCode = '', isOwner = false, myName = '';
let roomRef, msgsRef, membersRef, requestsRef;

// Firebase init
function fbInit(){
  app = initializeApp(window.firebaseConfig);
  auth = getAuth(app);
  db   = getDatabase(app);
  return signInAnonymously(auth);
}

/* ---------- Util ---------- */
function randCode(n=6){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let r=''; for(let i=0;i<n;i++) r+=chars[Math.floor(Math.random()*chars.length)];
  return r;
}
const roomLink = c => `${location.origin}${location.pathname}?room=${c}`;

function qrDraw(text){
  if (!qrCanvas) return;
  // QRCode lib from cdn
  // eslint-disable-next-line no-undef
  QRCode.toCanvas(qrCanvas, text, { width: 64, margin: 1 });
}

function addMsg(m, mine, open=true){
  if (open) messagesEl.classList.remove('empty');

  const wrap = document.createElement('div');
  wrap.className = 'msg' + (mine ? ' mine' : '');

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `${m.from || 'FROM'} • ${new Date(m.ts || Date.now()).toLocaleString()}`;
  wrap.appendChild(meta);

  const body = document.createElement('div');

  if (m.type === 'file' && m.file) {
    body.className = 'file';

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = m.file.name || '(file)';
    body.appendChild(name);

    if (m.file.dataURL) {
      if (isImg(m.file.mime)) {
        const img = document.createElement('img');
        img.className = 'preview';
        img.src = m.file.dataURL; img.alt = m.file.name || 'image';
        body.appendChild(img);
      } else if (isVideo(m.file.mime)) {
        const v = document.createElement('video');
        v.className = 'preview'; v.controls = true; v.src = m.file.dataURL;
        body.appendChild(v);
      } else if (isAudio(m.file.mime)) {
        const a = document.createElement('audio');
        a.className = 'preview'; a.controls = true; a.src = m.file.dataURL;
        body.appendChild(a);
      }
    }

    const a = document.createElement('a');
    a.href = m.file.dataURL || '#';
    a.download = m.file.name || 'file';
    a.textContent = 'Tải xuống';
    body.appendChild(a);

  } else {
    body.className = 'text';
    body.textContent = m.text || '';
  }

  wrap.appendChild(body);
  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function info(text, open=true){
  addMsg({type:'system', from:'FROM', text, ts:Date.now()}, false, open);
}

/* ---------- Flow ---------- */
async function ownerFlow(){
  isOwner = true;
  myName = 'Daibang';
  roomCode = randCode();
  bindRoom(roomCode);

  await set(ref(db, `rooms/${roomCode}/meta`), { createdAt: Date.now(), owner: myName });
  await update(membersRef, { [myName]: { name: myName, isOwner:true, ts: Date.now() } });

  renderTop();
  info(`Quét QR hoặc mở link để vào phòng.\nCODE: ${roomCode}\nLINK: ${roomLink(roomCode)}`);
}

async function guestFlow(code){
  isOwner = false;
  roomCode = code;
  myName = await nextGuestName(code);
  bindRoom(roomCode);
  renderTop();

  const reqKey = push(requestsRef).key;
  await set(child(requestsRef, reqKey), { name: myName, ts: Date.now() });
  info('Đang chờ chủ phòng duyệt…');

  onValue(membersRef, snap => {
    const val = snap.val() || {};
    if (val[myName]) {
      info(`Bạn đã được duyệt (${myName}).`);
      addMsg({from:'FROM', ts:Date.now(), text:`${myName} đã tham gia phòng.`});
    }
  });
}

function bindRoom(code){
  roomRef    = ref(db, `rooms/${code}`);
  msgsRef    = child(roomRef, 'messages');
  membersRef = child(roomRef, 'members');
  requestsRef= child(roomRef, 'requests');

  onChildAdded(msgsRef, snap => {
    const m = snap.val();
    addMsg(m, m.from === myName);
  });
}

async function nextGuestName(code){
  const snap = await get(child(ref(db), `rooms/${code}/members`));
  const members = snap.val() || {};
  const nums = Object.keys(members)
    .filter(k => /^chimse\d+$/.test(k))
    .map(k => parseInt(k.replace('chimse',''),10));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `chimse${next}`;
}

/* ---------- Actions ---------- */
async function approve(name){
  await update(membersRef, { [name]: { name, ts: Date.now() } });
}

function renderTop(){
  codeText.textContent = roomCode || '—';
  linkBtn.onclick = () => {
    const l = roomLink(roomCode);
    navigator.clipboard?.writeText(l);
    info('Đã copy LINK: ' + l, false);
  };
  qrDraw(roomLink(roomCode));
}

/* Gửi tin nhắn */
function sendText(text){
  if(!text) return;

  if(isCode(text)){
    if(roomCode && text.toUpperCase() !== roomCode){
      if(!confirm(`Vào phòng ${text.toUpperCase()}? Bạn sẽ rời phòng hiện tại.`)) return;
    }
    location.href = roomLink(text.toUpperCase());
    return;
  }

  if(!roomCode){
    info('Chưa có phòng. Vui lòng tạo/hoặc vào phòng trước.');
    return;
  }

  const id = push(msgsRef).key;
  const msg = { type:'text', from: myName || 'FROM', ts: Date.now(), text };
  set(child(msgsRef, id), msg);
}

/* Gửi file (DataURL) */
function sendFile(file){
  if(!file) return;
  if(!roomCode){ alert('Chưa ở trong phòng.'); return; }
  if(file.size > MAX_MB*1024*1024){ alert(`Tệp quá lớn (>${MAX_MB}MB).`); return; }

  const r = new FileReader();
  r.onerror = () => alert('Không đọc được tệp: ' + (r.error?.message || ''));
  r.onload = () => {
    const id = push(msgsRef).key;
    const msg = {
      type:'file', from: myName || 'FROM', ts: Date.now(),
      file: { name: file.name, mime: file.type, size: file.size, dataURL: r.result }
    };
    set(child(msgsRef, id), msg);
  };
  r.readAsDataURL(file);
}

/* ---------- UI events ---------- */
sendBtn?.addEventListener('click', ()=>{ const v=msgInput.value.trim(); sendText(v); msgInput.value=''; });
msgInput?.addEventListener('keydown', e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendBtn.click(); } });

sendCenter?.addEventListener('click', ()=>{ const v=msgCenter.value.trim(); sendText(v); msgCenter.value=''; });
msgCenter?.addEventListener('keydown', e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendCenter.click(); } });

attachBtn?.addEventListener('click', ()=> fileInput.click());
attachCenter?.addEventListener('click', ()=> fileCenter.click());

fileInput?.addEventListener('change', ()=>{ if(fileInput.files?.[0]){ sendFile(fileInput.files[0]); fileInput.value=''; } });
fileCenter?.addEventListener('change', ()=>{ if(fileCenter.files?.[0]){ sendFile(fileCenter.files[0]); fileCenter.value=''; } });

exitBtn?.addEventListener('click', ()=>{
  if(confirm('Đóng phòng & tạo mới?')) location.href = location.pathname;
});
homeBtn?.addEventListener('click', ()=>{
  if(confirm('Thoát phòng và về trang chủ?')) location.href = location.pathname;
});

/* ---------- Start ---------- */
await fbInit();

if(roomParam){
  await guestFlow(roomParam);
}else{
  await ownerFlow();
}
