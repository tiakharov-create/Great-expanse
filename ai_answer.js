
/* ===== AI ANSWERS v2 — мини-чат с нейросетью (patch_ai.py) ===== */
/* =====================================================================
   Событие -> кнопка «Написать свой ответ» -> полноэкранный мини-чат.
   Игрок пишет свои действия, нейросеть продолжает сцену ход за ходом;
   событие завершается только кнопкой «Завершить событие».

   Модель возвращает прозу + исход + эффекты. Эффекты проходят через
   applyB и жёсткий клампинг (clampEffects); ничего из белого списка
   в игровые данные напрямую не попадает.
   ===================================================================== */
(function () {
  'use strict';

  var LS_KEY = 'GE_AI_V1';
  var DEF = { url: '', key: '', model: '', temp: 0.8, maxtokens: 1200, system: '', autoSkip: false };

  /* границы эффектов */
  var LIM = { injury: 30, stones: 10, qi: 12, fame: 5, contrib: 25 };

  var DEFAULT_SYSTEM =
    'Ты — РП-мастер текстовой игры о культивации («Great Expanse: Road to Immortality»). ' +
    'Игрок описывает своими словами, что делает персонаж в событии. Ты продолжаешь сцену.\n' +
    'Правила:\n' +
    '1. Пиши на русском, 2-4 абзаца прозы от третьего лица. Ярко, конкретно, по существу события.\n' +
    '2. Не решай за игрока: не выдумывай его слов, мыслей, чувств и поступков. Реагируй на его действие.\n' +
    '3. Учитывай мир: культивация, ци, ранги, секты, путь героя; чудеса — редко и в рамках события.\n' +
    '4. Учитывай сводку персонажа и недавние записи дневника.\n' +
    '5. Ответ — СТРОГО один JSON-объект, без markdown-ограждений и без пояснений рядом:\n' +
    '{"text":"<проза>","outcome":"win|draw|lose|neutral","effects":{"injury":[0,20],"heal":false,"stones":0,"qi":0,"fame":0,"contrib":0}}\n' +
    '6. outcome — итог именно этого хода. effects — только реальные последствия хода, умеренные; ' +
    'если ничего не меняется, оставь нули. Не выдавай больших чисел.';

  var CFG = load();
  var CTX = null;

  function load() {
    try {
      var d = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      var o = {};
      for (var k in DEF) o[k] = DEF[k];
      for (var k2 in d) if (Object.prototype.hasOwnProperty.call(DEF, k2)) o[k2] = d[k2];
      return o;
    } catch (e) { return Object.assign({}, DEF); }
  }
  function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(CFG)); } catch (e) {} }
  function on() { return !!(CFG.url && CFG.key && CFG.model); }
  function clamp(v, a, b) { v = +v || 0; return v < a ? a : v > b ? b : v; }
  function esc(s) { return typeof window !== 'undefined' && window.esc ? window.esc(s) : String(s == null ? '' : s); }

  /* ---------- свой стиль окна RP: на весь экран, скролл, мелкий шрифт ---------- */
  var st = document.createElement('style');
  st.textContent =
    '#modalCard.ai-big{position:fixed;top:0;bottom:0;left:50%;transform:translateX(-50%);' +
      'width:100vw;max-width:900px;height:100vh;height:100dvh;max-height:none;margin:0;' +
      'border-radius:0;border-top:none;padding:10px 12px calc(10px + env(safe-area-inset-bottom));' +
      'display:flex;flex-direction:column;overflow:hidden;animation:none;z-index:31}' +
    '#modalCard.ai-big h2{font-size:18px;line-height:1.25;margin:0 0 6px;padding-right:38px}' +
    '#modalCard.ai-big .m-text{font-size:14px;line-height:1.5;margin-bottom:8px}' +
    '#modalCard.ai-big .ev-art,#modalCard.ai-big .boxpic{display:none}' +
    '#modalCard.ai-big .ai-log{flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;' +
      'overscroll-behavior:contain;padding:2px 2px 6px}' +
    '#modalCard.ai-big .ai-composer{flex:0 0 auto;border-top:1px solid var(--line);padding-top:8px;background:var(--surface)}' +
    '#modalCard.ai-big textarea{width:100%;box-sizing:border-box;font:inherit;font-size:14px;line-height:1.4;' +
      'min-height:54px;resize:none;margin-bottom:8px}' +
    '#modalCard.ai-big .choices{display:flex;gap:8px;flex-wrap:wrap;margin:0}' +
    '#modalCard.ai-big .choices .btn{flex:1 1 120px;font-size:13px;padding:9px 10px;margin:0}' +
    '#modalCard.ai-big .ai-rp{font-family:var(--serif);font-size:14px;line-height:1.55;white-space:pre-wrap;margin:0 0 10px;animation:aiFade .25s ease both}' +
    '#modalCard.ai-big .ai-you{font-size:13px;color:var(--muted);margin:0 0 10px;animation:aiFade .25s ease both}' +
    '#modalCard.ai-big .ai-sys{font-size:12px;line-height:1.4;color:var(--accent);margin:0 0 10px}' +
    '#modalCard.ai-big .note{font-size:12px}' +
    '@keyframes aiFade{from{opacity:0}to{opacity:1}}';
  document.head.appendChild(st);

  function card() { return document.getElementById('modalCard'); }
  function aiBig() { var c = card(); if (c) c.classList.add('ai-big'); }
  function aiSmall() { var c = card(); if (c) c.classList.remove('ai-big'); }

  /* ---------- настройки: значения для полей листа ---------- */
  function aiVal(k) { return CFG[k] == null ? '' : String(CFG[k]); }
  window.aiVal = aiVal;
  window.aiCfg = function () { return CFG; };
  window.aiOn = on;

  /* ---------- кнопка в карточке события ---------- */
  function btnHTML() {
    if (!on()) return '';
    return '<button class="choice" data-act="choice-custom">' +
      '<span>Написать свой ответ</span>' +
      '<small>Мини-чат с нейросетью</small></button>';
  }
  window.aiBtnHTML = btnHTML;

  /* ---------- раздел настроек ---------- */
  function settingsHTML() {
    return '<h3>Ответы нейросети</h3>' +
      '<p class="note">Ссылка и ключ хранятся только в этом браузере и уходят лишь на указанный адрес. ' +
      'Если системный промпт пуст, используется встроенная инструкция мастера игры.</p>' +
      '<input id="aiUrl" data-ai="url" placeholder="https://openrouter.ai/api/v1" value="' + esc(aiVal('url')) + '">' +
      '<input id="aiKey" data-ai="key" type="password" placeholder="API ключ" value="' + esc(aiVal('key')) + '">' +
      '<input id="aiModel" data-ai="model" placeholder="Модель (например ...:free)" value="' + esc(aiVal('model')) + '">' +
      '<label class="note">Температура <input id="aiTemp" data-ai="temp" type="number" step="0.1" min="0" max="2" value="' + esc(aiVal('temp')) + '"></label>' +
      '<label class="note">Макс. токенов <input id="aiMax" data-ai="maxtokens" type="number" min="50" max="8000" value="' + esc(aiVal('maxtokens')) + '"></label>' +
      '<textarea id="aiSystem" data-ai="system" rows="4" placeholder="Системный промпт (необязательно)">' + esc(aiVal('system')) + '</textarea>' +
      '<div class="seg">' +
      '<button data-act="ai-auto" data-v="on" aria-pressed="' + (CFG.autoSkip === true) + '">Авто при скипе: вкл</button>' +
      '<button data-act="ai-auto" data-v="off" aria-pressed="' + (CFG.autoSkip !== true) + '">Авто при скипе: выкл</button>' +
      '</div>' +
      '<button class="btn block" data-act="ai-save">Сохранить</button>' +
      '<button class="btn block" data-act="ai-test">Проверить связь</button>';
  }
  window.aiSettingsHTML = settingsHTML;

  /* ---------- контекст ---------- */
  function stripTags(s) { return String(s == null ? '' : s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }

  function charSummary(c) {
    if (!c) return '';
    var out = [];
    try { out.push('Персонаж: ' + c.name + ', ' + Math.floor(ageYears(c)) + ' лет, ' + realmLabel(c.rank, c.stage, c.gender)); } catch (e) {}
    try { var pn = pathName(pathOf(c)); if (pn) out.push('Путь: ' + pn); } catch (e) {}
    try { if (c.sect && c.sect.name) out.push('Секта: ' + c.sect.name); } catch (e) {}
    try { if (c.plane != null && PLANES[c.plane] && PLANES[c.plane].name) out.push('Место: ' + PLANES[c.plane].name); } catch (e) {}
    try { if (c.injury > 0) out.push('Ранение: ' + c.injury + ' мес.'); } catch (e) {}
    try { out.push('Очки внимания: ' + (c.stones || 0) + ' камней, ци ' + (c.qi || 0) + ', слава ' + (c.fame || 0) + '.'); } catch (e) {}
    return out.join('\n');
  }

  function recentLog(c) {
    if (!c || !c.log || !c.log.length) return '';
    return c.log.slice(-8).map(function (x) { return '- ' + stripTags(x.t || ''); }).join('\n');
  }

  function contextText(ctx) {
    var u = 'Событие: ' + stripTags(ctx.title) + '\n' +
            'Описание: ' + stripTags(ctx.body) + '\n';
    if (ctx.choices) u += 'Возможные исходы:\n' + ctx.choices + '\n';
    var cs = charSummary(S.char);
    if (cs) u += '\n' + cs + '\n';
    var rl = recentLog(S.char);
    if (rl) u += '\nНедавнее в дневнике:\n' + rl + '\n';
    return u;
  }

  function buildMessages(ctx, answer) {
    var msgs = [{ role: 'system', content: CFG.system || DEFAULT_SYSTEM }];
    msgs.push({ role: 'user', content: contextText(ctx) });
    var h = ctx.hist.slice(-12);
    for (var i = 0; i < h.length; i++) msgs.push({ role: h[i].role, content: h[i].content });
    msgs.push({ role: 'user', content: 'Игрок пишет: ' + answer });
    return msgs;
  }

  /* ---------- запрос ---------- */
  function fetchAI(msgs, ctrl) {
    var base = String(CFG.url || '').replace(/\/+$/, '');
    if (!base) throw new Error('не задан адрес');
    var url = /\/chat\/completions$/i.test(base) ? base : base + '/chat/completions';
    var body = {
      model: CFG.model,
      messages: msgs,
      temperature: clamp(CFG.temp == null ? 0.8 : CFG.temp, 0, 2),
      max_tokens: Math.round(clamp(CFG.maxtokens == null ? 1200 : CFG.maxtokens, 50, 8000))
    };
    var ac = ctrl || ((typeof AbortController !== 'undefined') ? new AbortController() : null);
    var timer = ac ? setTimeout(function () { try { ac.abort(); } catch (e) {} }, 90000) : null;
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CFG.key },
      body: JSON.stringify(body),
      signal: ac ? ac.signal : undefined
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      var c = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
      if (typeof c !== 'string' || !c.trim()) throw new Error('пустой ответ');
      return c;
    }).finally(function () { if (timer) clearTimeout(timer); });
  }

  /* ---------- разбор ответа ---------- */
  function norm(o) {
    o = o || {};
    return {
      text: typeof o.text === 'string' ? o.text : '',
      outcome: typeof o.outcome === 'string' ? o.outcome : '',
      effects: (o.effects && typeof o.effects === 'object') ? o.effects : null,
      _src: 'json'
    };
  }

  function firstObject(s) {
    var i = s.indexOf('{');
    while (i >= 0) {
      var d = 0, inStr = false, q = '', escCh = false, j;
      for (j = i; j < s.length; j++) {
        var ch = s.charAt(j);
        if (inStr) {
          if (escCh) { escCh = false; continue; }
          if (ch === '\\') { escCh = true; continue; }
          if (ch === q) inStr = false;
          continue;
        }
        if (ch === '"' || ch === "'") { inStr = true; q = ch; continue; }
        if (ch === '{') d++;
        else if (ch === '}') { d--; if (d === 0) return s.slice(i, j + 1); }
      }
      i = s.indexOf('{', i + 1);
    }
    return null;
  }

  function fixJSON(x) {
    x = x.replace(/,\s*([}\]])/g, '$1');
    x = x.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
    return x;
  }

  function tryParse(x) {
    var v = null;
    try { v = JSON.parse(x); } catch (e) { return null; }
    if (v && typeof v === 'object') return v;
    return null;
  }

  function decodeStr(raw, single) {
    try {
      if (!single) return JSON.parse('"' + raw + '"');
    } catch (e) {}
    return raw.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
             .replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  }

  function grabQuoted(s, key) {
    var d = s.match(new RegExp('"' + key + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"'));
    if (d) return decodeStr(d[1], false);
    var g = s.match(new RegExp("'" + key + "'\\s*:\\s*'((?:[^'\\\\]|\\\\.)*)'"));
    if (g) return decodeStr(g[1], true);
    return null;
  }

  function parse(content) {
    var s = String(content || '').replace(/^\uFEFF/, '').trim();
    if (!s) return { text: '', outcome: '', effects: null, _src: 'empty' };
    var f = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (f) s = f[1].trim();

    var cands = [];
    var greedy = s.match(/\{[\s\S]*\}/);
    if (greedy) cands.push(greedy[0]);
    var balanced = firstObject(s);
    if (balanced && cands.indexOf(balanced) < 0) cands.push(balanced);
    cands.push(s);

    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      var variants = [c, fixJSON(c)];
      if (/'text'\s*:/.test(c) && !/"text"\s*:/.test(c)) {
        variants.push(c.replace(/'((?:[^'\\]|\\.)*)'/g, function (m, p) {
          return '"' + p.replace(/"/g, '\\"') + '"';
        }));
      }
      for (var k = 0; k < variants.length; k++) {
        var v = tryParse(variants[k]);
        if (v) {
          var out = norm(v);
          if (out.text) return out;
        }
      }
    }

    /* JSON обрезан/битый: вытащить текст регуляркой */
    var t = grabQuoted(s, 'text');
    if (t) {
      var oc = s.match(/["']outcome["']\s*:\s*["']([A-Za-z]+)["']/);
      var fx = null;
      var ei = s.search(/["']effects["']\s*:\s*\{/);
      if (ei >= 0) {
        var sub = s.slice(ei);
        var bo = firstObject(sub);
        if (bo) {
          try { fx = JSON.parse(fixJSON(bo)).effects; } catch (e) { fx = null; }
          if (fx == null) { try { fx = JSON.parse(fixJSON(bo)); } catch (e) { fx = null; } }
        }
      }
      return { text: t, outcome: (oc && oc[1]) || '', effects: (fx && typeof fx === 'object') ? fx : null, _src: 'loose' };
    }

    var sv = salvage(s);
    if (sv) return { text: sv, outcome: '', effects: null, _src: 'salvage' };
    return { text: s, outcome: '', effects: null, _src: 'prose' };
  }

  /* обрезанный JSON: вернуть хотя бы начало текста */
  function salvage(s) {
    var i = s.indexOf('"text"');
    if (i < 0) i = s.indexOf("'text'");
    if (i < 0) return null;
    var r = s.slice(i + 6).replace(/^\s*:\s*/, '');
    var single = false;
    if (r.charAt(0) === "'") single = true;
    if (r.charAt(0) !== '"' && r.charAt(0) !== "'") return null;
    r = r.slice(1);
    var stop = single ? /'\s*,\s*["'](outcome|effects)["']/ : /"\s*,\s*["'](outcome|effects)["']/;
    var m = r.search(stop);
    if (m >= 0) r = r.slice(0, m);
    else {
      var m2 = single ? r.match(/'\s*\}\s*$/) : r.match(/"\s*\}\s*$/);
      if (m2) r = r.slice(0, m2.index);
    }
    r = decodeStr(r, single).trim();
    return r ? r : null;
  }

  /* **полужирный** и *курсив* — как в РП-чатах */
  function rich(t) {
    var s = esc(String(t || ''));
    s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    s = s.replace(/\*([^*]+)\*/g, '<i>$1</i>');
    return s;
  }

  /* белый список эффектов + кламп */
  function clampEffects(e) {
    if (!e || typeof e !== 'object') return null;
    var b = {}, n = 0, a, lo, hi, v;
    if (e.injury != null) {
      a = Array.isArray(e.injury) ? e.injury : [e.injury, e.injury];
      lo = clamp(a[0], 0, LIM.injury); hi = clamp(a[1] != null ? a[1] : lo, 0, LIM.injury);
      if (hi > 0) { b.injury = [Math.min(lo, hi), Math.max(lo, hi)]; n++; }
    }
    if (e.heal) { b.heal = true; n++; }
    v = clamp(e.stones, -LIM.stones, LIM.stones); if (v) { b.stones = v; n++; }
    v = clamp(e.qi, -3, LIM.qi); if (v) { b.qi = v; n++; }
    v = clamp(e.fame, 0, LIM.fame); if (v) { b.fame = v; n++; }
    v = clamp(e.contrib, 0, LIM.contrib); if (v) { b.contrib = v; n++; }
    return n ? b : null;
  }

  /* ---------- чат ---------- */
  function logEl() { return document.getElementById('aiLog'); }
  function scrollLog() { var l = logEl(); if (l) l.scrollTop = l.scrollHeight; }

  function addMsg(kind, html) {
    var l = logEl(); if (!l) return;
    var p = document.createElement('p');
    p.className = kind;
    p.innerHTML = html;
    l.appendChild(p);
    scrollLog();
  }

  function setBusy(b) {
    var btn = document.querySelector('#modalCard [data-act=ai-send]');
    if (btn) { btn.disabled = b; btn.textContent = b ? 'Думает…' : 'Отправить'; }
    var t = document.getElementById('aiAnswer');
    if (t) t.disabled = false;
  }

  function openAnswer() {
    var c = S.char; if (!c || !c.pending) return;
    var p = c.pending, def = EV[p.type]; if (!def) return;
    var ch = (def.choices(p.data, c, S) || []).map(function (o) {
      return o.label + (o.note ? ' — ' + o.note : '');
    }).join('\n');
    CTX = {
      p: p, title: def.title(p.data, c), body: def.text(p.data, c), choices: ch,
      hist: [], busy: false, ctrl: null, lastOutcome: ''
    };
    ui.modal = 'ai-chat';
    openModal(
      '<h2>' + esc(CTX.title) + '</h2>' +
      '<div class="ai-log" id="aiLog">' +
        (CTX.body ? '<div class="m-text">' + eventBody(CTX.body) + '</div>' : '') +
        (CTX.choices ? '<p class="note">' + esc(CTX.choices) + '</p>' : '') +
        '<p class="ai-sys">Мини-чат: пишите свои действия, нейросеть продолжит сцену ход за ходом. ' +
        'Событие закроется только кнопкой «Завершить событие».</p>' +
      '</div>' +
      '<div class="ai-composer">' +
        '<textarea id="aiAnswer" rows="2" maxlength="800" placeholder="Что вы делаете?"></textarea>' +
        '<div class="choices">' +
          '<button class="btn primary" data-act="ai-send">Отправить</button>' +
          '<button class="btn" data-act="ai-back">Варианты игры</button>' +
          '<button class="btn" data-act="ai-finish">Завершить событие</button>' +
        '</div>' +
      '</div>');
    aiBig();
    scrollLog();
    var t = document.getElementById('aiAnswer'); if (t) t.focus();
  }

  function outcomeRu(o) {
    return ({ win: 'победа', draw: 'ничья', lose: 'поражение', neutral: 'нейтрально' })[o] || o;
  }

  function applyParsed(parsed) {
    var c = S.char; if (!c) return;
    var lines = [], say = say0(c, lines);
    var fx = clampEffects(parsed.effects), applied = false;
    if (fx) { try { applyB(c, S, fx, say, {}); applied = true; } catch (e) {} }
    if (lines.length) addMsg('ai-sys', lines.map(function (l) { return esc(l.t); }).join(' · '));
    var o = String(parsed.outcome || '').toLowerCase();
    if (o) {
      CTX.lastOutcome = o;
      addMsg('ai-sys', 'Исход хода: ' + esc(outcomeRu(o)) + (applied ? '' : ''));
    } else if (!applied && parsed._src === 'prose') {
      addMsg('ai-sys', 'Модель ответила без игровых данных — последствия не применены.');
    }
  }

  function send() {
    if (!CTX || CTX.busy) return;
    var t = document.getElementById('aiAnswer');
    var v = t ? t.value.trim() : '';
    if (!v) { toast('Напишите ответ.'); return; }
    if (!on()) { toast('Сначала заполните настройки нейросети.'); return; }
    CTX.busy = true; setBusy(true);
    addMsg('ai-you', '<b>Вы:</b> ' + esc(v));
    CTX.hist.push({ role: 'user', content: v });
    var l = logEl(), wait = document.createElement('p');
    wait.className = 'ai-sys'; wait.id = 'aiWait'; wait.textContent = 'Нейросеть думает…';
    if (l) l.appendChild(wait);
    scrollLog();
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    CTX.ctrl = ctrl;
    fetchAI(buildMessages(CTX, v), ctrl).then(function (content) {
      var wt = document.getElementById('aiWait'); if (wt && wt.parentNode) wt.parentNode.removeChild(wt);
      var parsed = parse(content);
      var rp = String(parsed.text || '').trim();
      addMsg('ai-rp', rp ? rich(rp) : '<span class="note">Нейросеть не дала текста.</span>');
      CTX.hist.push({ role: 'assistant', content: rp });
      if (CTX.hist.length > 16) CTX.hist = CTX.hist.slice(-16);
      applyParsed(parsed);
      save(); render(true);
      CTX.busy = false; CTX.ctrl = null; setBusy(false);
    }).catch(function (err) {
      var wt = document.getElementById('aiWait'); if (wt && wt.parentNode) wt.parentNode.removeChild(wt);
      addMsg('ai-sys', '<b>Ошибка:</b> ' + esc(err && err.message ? err.message : 'нет ответа') +
        '. Чат открыт — можно написать ещё раз или вернуться к вариантам.');
      CTX.busy = false; CTX.ctrl = null; setBusy(false);
    });
  }

  function finishEvent() {
    var c = S.char;
    if (CTX && CTX.ctrl) { try { CTX.ctrl.abort(); } catch (e) {} }
    CTX = null;
    if (c) c.pending = null;
    aiSmall();
    closeModal();
    save(); render(true);
  }

  function backToChoices() {
    if (CTX && CTX.ctrl) { try { CTX.ctrl.abort(); } catch (e) {} }
    CTX = null;
    aiSmall();
    if (S && S.char && S.char.pending) showPending();
  }

  /* ---------- действия ---------- */
  ACTIONS['choice-custom'] = function () { openAnswer(); };
  ACTIONS['ai-send'] = function () { send(); };
  ACTIONS['ai-finish'] = function () { finishEvent(); };
  ACTIONS['ai-back'] = function () { backToChoices(); };
  ACTIONS['ai-cancel'] = function () { backToChoices(); };
  ACTIONS['ai-save'] = function () { save(); toast('Настройки нейросети сохранены.'); };
  ACTIONS['ai-auto'] = function (el) {
    CFG.autoSkip = el.dataset.v === 'on'; save(); renderSheet();
  };
  ACTIONS['ai-test'] = function () {
    if (!on()) { toast('Сначала заполните ссылку, ключ и модель.'); return; }
    toast('Проверяем связь…');
    fetchAI([{ role: 'user', content: 'Ответь одним словом: работает.' }]).then(function (c) {
      toast('Связь есть: ' + String(c).slice(0, 60));
    }).catch(function (e) {
      toast('Не удалось: ' + (e && e.message ? e.message : 'ошибка'));
    });
  };

  /* поля настроек: пишут сразу, без кнопки */
  document.addEventListener('input', function (e) {
    var el = e.target, k = el && el.dataset && el.dataset.ai;
    if (!k) return;
    var v = el.value;
    if (k === 'temp' || k === 'maxtokens') { v = parseFloat(v); if (!isFinite(v)) v = DEF[k]; }
    CFG[k] = v; save();
  });

})();
