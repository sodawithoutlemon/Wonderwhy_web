// wonderwhy.net: küçük geliştirmeler. Bu dosya olmadan da her şey okunur ve
// sesler tarayıcının kendi oynatıcısıyla çalar. Çerez ya da depolama yok.
(function () {
  'use strict';
  var doc = document;
  var root = doc.documentElement;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- Kaydırınca beliriş (StaggerIn). IO yoksa her şey hemen görünür.
  var reveals = doc.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px' });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('in'); });
  }

  // ---- Kayan duvar: durdur düğmesi (WCAG 2.2.2) ve ekran dışındayken dur.
  var hero = doc.querySelector('.hero');
  // Manşetler HTML'de bir kez (Y3, 20 Eki). Kesintisiz kayma (-50%) için izin
  // ikinci kopyası burada; aria-hidden duvarın içinde.
  if (hero) {
    [].forEach.call(hero.querySelectorAll('.wall-track'), function (track) {
      [].slice.call(track.children).forEach(function (t) { track.appendChild(t.cloneNode(true)); });
    });
  }
  var toggle = hero && hero.querySelector('.wall-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var paused = hero.classList.toggle('paused');
      toggle.setAttribute('aria-pressed', paused ? 'true' : 'false');
    });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        hero.classList.toggle('offscreen', !entries[0].isIntersecting);
      }).observe(hero.querySelector('.wall'));
    }
  }

  // ---- Ses oynatıcı: tek ses çalar; döküm karakter sayısına göre yanar.
  var players = [].slice.call(doc.querySelectorAll('[data-player]'));
  players.forEach(function (player) {
    var audio = player.querySelector('audio');
    var button = player.querySelector('.play');
    var card = player.closest('.card');
    var transcript = card && card.querySelector('[data-transcript]');
    var segs = transcript ? [].slice.call(transcript.querySelectorAll('[data-seg]')).map(split) : [];

    function setPlaying(on) {
      player.classList.toggle('playing', on);
      if (transcript) transcript.classList.toggle('playing', on);
      button.setAttribute('aria-label', button.getAttribute(on ? 'data-pause-label' : 'data-play-label'));
    }
    button.addEventListener('click', function () {
      if (audio.paused) {
        players.forEach(function (p) {
          var a = p.querySelector('audio');
          if (a !== audio && !a.paused) a.pause();
        });
        var played = audio.play();
        if (played && played.catch) played.catch(function () { setPlaying(false); });
      } else {
        audio.pause();
      }
    });
    audio.addEventListener('play', function () { setPlaying(true); });
    audio.addEventListener('pause', function () { setPlaying(false); });
    audio.addEventListener('ended', function () {
      setPlaying(false);
      audio.currentTime = 0;
      light(0);
    });
    audio.addEventListener('timeupdate', function () { light(audio.currentTime); });

    function light(t) {
      segs.forEach(function (s) {
        var p = s.end > s.start ? (t - s.start) / (s.end - s.start) : 0;
        var upto = p * s.total;
        s.words.forEach(function (w) { w.el.classList.toggle('on', t > s.start && w.at < upto); });
      });
    }
  });

  // Bir bölümün metnini kelimelere böler (görünmez .vh etiketi hariç).
  function split(el) {
    var start = parseFloat(el.getAttribute('data-start')) || 0;
    var end = parseFloat(el.getAttribute('data-end')) || 0;
    var words = [];
    var total = 0;
    var walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        return n.parentNode.closest('.vh') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (node) {
      var frag = doc.createDocumentFragment();
      node.nodeValue.split(/(\s+)/).forEach(function (part) {
        if (!part) return;
        if (/^\s+$/.test(part)) { frag.appendChild(doc.createTextNode(part)); return; }
        var span = doc.createElement('span');
        span.className = 'w';
        span.textContent = part;
        words.push({ el: span, at: total });
        total += part.length + 1;
        frag.appendChild(span);
      });
      node.parentNode.replaceChild(frag, node);
    });
    return { start: start, end: end, words: words, total: total };
  }

  // ---- Dil önerisi: dışarıdan gelen ve tarayıcısı başka bir dilimizi isteyene
  // (24 Eki: dört dil). Hedef, tarayıcının dilleri içinde sitede olan ilk dil.
  var lang = root.lang;
  var prefs = [].map.call(
    navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''],
    function (l) { return String(l).toLowerCase().slice(0, 2); }
  );
  var hintData = doc.getElementById('lang-hint');
  var hints = hintData ? JSON.parse(hintData.textContent) : {};
  var target = prefs.filter(function (l) { return hints[l]; })[0] || 'en';
  // İngilizce sayfada tarayıcının ilk dilimizi; diğerlerinde sayfanın dili
  // tarayıcıda hiç yoksa öner.
  var suggest = target !== lang && (lang === 'en' || prefs.indexOf(lang) < 0);
  // Dil bağlantıları göreli; .href bulunulan adrese göre çözülür (hreflang
  // etiketi hep wonderwhy.net'i gösterir, GitHub alt yolunda yanlış olur).
  var alt = doc.querySelector('a.lang-link[hreflang="' + target + '"]');
  var fromHere = doc.referrer && doc.referrer.indexOf(location.origin) === 0;
  if (alt && !fromHere && suggest) {
    var h = hints[target];
    var bar = doc.createElement('div');
    bar.className = 'lang-hint';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', h.link);
    bar.lang = target;
    bar.innerHTML = '<div class="wrap"><span></span><a></a><button type="button">×</button></div>';
    bar.querySelector('span').textContent = h.text;
    var a = bar.querySelector('a');
    a.textContent = h.link;
    a.href = alt.href.split('#')[0] + location.hash;
    a.hreflang = target;
    var close = bar.querySelector('button');
    close.setAttribute('aria-label', h.close);
    close.addEventListener('click', function () { bar.remove(); });
    var skip = doc.querySelector('.skip');
    doc.body.insertBefore(bar, skip ? skip.nextSibling : doc.body.firstChild);
  }

  root.classList.add('ready');
})();
