(function(){
  "use strict";
  var STORAGE_KEY = "rapport-photo:courant";
  var state = {
    projet: "", date: "", lieu: "", auteur: "",
    layout: 4,
    photos: [] // {id, dataUrl, comment}
  };
  var saveTimer = null;

  var $ = function(id){ return document.getElementById(id); };
  var elProjet = $("f-projet"), elDate = $("f-date"), elLieu = $("f-lieu"), elAuteur = $("f-auteur");
  var elGrid = $("photo-grid"), elEmpty = $("empty-state"), elStatus = $("status-bar");
  var elFileInput = $("file-input");
  var btnAdd = $("btn-add"), btnPdf = $("btn-pdf"), btnReset = $("btn-reset");
  var elToast = $("toast");
  var segmented = $("layout-segmented");

  function todayISO(){
    var d = new Date();
    var m = String(d.getMonth()+1).padStart(2,"0");
    var day = String(d.getDate()).padStart(2,"0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function showToast(msg){
    elToast.textContent = msg;
    elToast.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function(){ elToast.classList.remove("show"); }, 2200);
  }

  function scheduleSave(){
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 500);
  }

  // ---------- Stockage : IndexedDB (vrai navigateur, ex. Safari iPhone) ----------
  // avec window.storage utilisé en priorité quand disponible (aperçu Claude).
  var IDB_NAME = "rapport-photo-db";
  var IDB_STORE = "kv";
  var idbPromise = null;

  function openIDB(){
    if(idbPromise) return idbPromise;
    idbPromise = new Promise(function(resolve, reject){
      try{
        if(!window.indexedDB){ reject(new Error("IndexedDB indisponible")); return; }
        var req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = function(e){
          var db = e.target.result;
          if(!db.objectStoreNames.contains(IDB_STORE)){
            db.createObjectStore(IDB_STORE, { keyPath: "key" });
          }
        };
        req.onsuccess = function(e){ resolve(e.target.result); };
        req.onerror = function(e){ reject((e.target && e.target.error) || new Error("Erreur IndexedDB")); };
      }catch(err){ reject(err); }
    });
    return idbPromise;
  }

  function idbSet(key, value){
    return openIDB().then(function(db){
      return new Promise(function(resolve, reject){
        try{
          var tx = db.transaction(IDB_STORE, "readwrite");
          tx.objectStore(IDB_STORE).put({ key: key, value: value });
          tx.oncomplete = function(){ resolve(true); };
          tx.onerror = function(e){ reject((e.target && e.target.error) || new Error("Erreur écriture")); };
        }catch(err){ reject(err); }
      });
    });
  }

  function idbGet(key){
    return openIDB().then(function(db){
      return new Promise(function(resolve, reject){
        try{
          var tx = db.transaction(IDB_STORE, "readonly");
          var req = tx.objectStore(IDB_STORE).get(key);
          req.onsuccess = function(){ resolve(req.result ? req.result.value : null); };
          req.onerror = function(e){ reject((e.target && e.target.error) || new Error("Erreur lecture")); };
        }catch(err){ reject(err); }
      });
    });
  }

  function hasClaudeStorage(){
    return typeof window.storage !== "undefined" && window.storage && typeof window.storage.get === "function";
  }

  function storagePut(key, value){
    if(hasClaudeStorage()){
      return window.storage.set(key, value, false).then(function(){ return true; }).catch(function(){
        return idbSet(key, value);
      });
    }
    return idbSet(key, value).catch(function(){
      try{ localStorage.setItem(key, value); return true; }catch(e){ return false; }
    });
  }

  function storageGet(key){
    if(hasClaudeStorage()){
      return window.storage.get(key, false).then(function(res){ return res ? res.value : null; }).catch(function(){
        return idbGet(key);
      });
    }
    return idbGet(key).catch(function(){
      try{ return localStorage.getItem(key); }catch(e){ return null; }
    });
  }

  function persist(){
    try{
      var json = JSON.stringify(state, function(key, value){
        // Ne jamais persister les caches internes (préfixe _) : ils sont
        // régénérés à la volée et doubleraient inutilement la taille stockée.
        if(key.indexOf("_") === 0) return undefined;
        return value;
      });
      storagePut(STORAGE_KEY, json).catch(function(e){
        console.error("Sauvegarde impossible", e);
      });
    }catch(e){ console.error(e); }
  }

  // Anciennes annotations texte créées avant le passage à une police plus
  // petite : on les remet à la taille actuelle par défaut pour homogénéiser.
  var LEGACY_TEXT_SIZES = [0.045];
  var DEFAULT_TEXT_SIZE = 0.024;
  function normalizeAnnotationSizes(photos){
    (photos||[]).forEach(function(photo){
      (photo.annotations||[]).forEach(function(a){
        if(a.type === "text" && LEGACY_TEXT_SIZES.indexOf(a.fontSize) !== -1){
          a.fontSize = DEFAULT_TEXT_SIZE;
          photo._renderedDataUrl = null;
        }
      });
    });
  }

  function load(){
    storageGet(STORAGE_KEY).then(function(value){
      if(value){
        try{
          var data = JSON.parse(value);
          state.projet = data.projet || "";
          state.date = data.date || todayISO();
          state.lieu = data.lieu || "";
          state.auteur = data.auteur || "";
          state.layout = data.layout || 4;
          state.photos = Array.isArray(data.photos) ? data.photos : [];
          normalizeAnnotationSizes(state.photos);
        }catch(e){ state.date = todayISO(); }
      } else {
        state.date = todayISO();
      }
      renderAll();
      scheduleSave();
    }).catch(function(){
      state.date = todayISO();
      renderAll();
    });
  }

  function renderAll(){
    elProjet.value = state.projet;
    elDate.value = state.date;
    elLieu.value = state.lieu;
    elAuteur.value = state.auteur;
    Array.prototype.forEach.call(segmented.querySelectorAll("button"), function(b){
      b.classList.toggle("active", Number(b.dataset.n) === state.layout);
    });
    renderGrid();
  }

  function renderGrid(){
    elGrid.innerHTML = "";
    if(state.photos.length === 0){
      elEmpty.style.display = "block";
      btnPdf.disabled = true;
    } else {
      elEmpty.style.display = "none";
      btnPdf.disabled = false;
    }
    state.photos.forEach(function(photo, idx){
      var card = document.createElement("div");
      card.className = "photo-card";

      var thumbWrap = document.createElement("div");
      thumbWrap.className = "thumb-wrap";
      var img = document.createElement("img");
      img.src = photo.dataUrl;
      img.alt = "Photo " + (idx+1);
      thumbWrap.appendChild(img);
      if(photo.annotations && photo.annotations.length){
        getComposedDataUrl(photo).then(function(url){ img.src = url; });
      }

      var badge = document.createElement("div");
      badge.className = "num-badge stencil";
      badge.textContent = String(idx+1).padStart(2,"0");
      thumbWrap.appendChild(badge);

      var actions = document.createElement("div");
      actions.className = "card-actions";

      var upBtn = document.createElement("button");
      upBtn.className = "icon-btn";
      upBtn.title = "Monter";
      upBtn.textContent = "↑";
      upBtn.disabled = idx === 0;
      upBtn.style.opacity = idx === 0 ? "0.4" : "1";
      upBtn.addEventListener("click", function(){ movePhoto(idx, -1); });

      var downBtn = document.createElement("button");
      downBtn.className = "icon-btn";
      downBtn.title = "Descendre";
      downBtn.textContent = "↓";
      downBtn.disabled = idx === state.photos.length - 1;
      downBtn.style.opacity = idx === state.photos.length - 1 ? "0.4" : "1";
      downBtn.addEventListener("click", function(){ movePhoto(idx, 1); });

      var delBtn = document.createElement("button");
      delBtn.className = "icon-btn danger";
      delBtn.title = "Supprimer";
      delBtn.textContent = "✕";
      delBtn.addEventListener("click", function(){ deletePhoto(idx); });

      actions.appendChild(upBtn);
      actions.appendChild(downBtn);
      actions.appendChild(delBtn);
      thumbWrap.appendChild(actions);

      var annotateBtn = document.createElement("button");
      annotateBtn.className = "annotate-btn";
      annotateBtn.type = "button";
      annotateBtn.innerHTML = "✎ Annoter";
      annotateBtn.addEventListener("click", function(){ openAnnotator(photo, idx); });
      thumbWrap.appendChild(annotateBtn);

      var body = document.createElement("div");
      body.className = "card-body";
      var label = document.createElement("label");
      label.textContent = "Commentaire — Photo " + (idx+1);
      var textarea = document.createElement("textarea");
      textarea.value = photo.comment || "";
      textarea.placeholder = "Ex. Pose de la charpente, versant nord terminé...";
      textarea.addEventListener("input", function(){
        photo.comment = textarea.value;
        scheduleSave();
      });
      body.appendChild(label);
      body.appendChild(textarea);

      card.appendChild(thumbWrap);
      card.appendChild(body);
      elGrid.appendChild(card);
    });
    updateStatus();
  }

  function updateStatus(){
    var n = state.photos.length;
    if(n === 0){ elStatus.textContent = ""; return; }
    var pages = Math.ceil(n / state.layout);
    elStatus.textContent = n + (n>1?" photos":" photo") + " · " + pages + (pages>1?" pages PDF":" page PDF") + " (" + state.layout + "/page)";
  }

  function movePhoto(idx, dir){
    var newIdx = idx + dir;
    if(newIdx < 0 || newIdx >= state.photos.length) return;
    var tmp = state.photos[idx];
    state.photos[idx] = state.photos[newIdx];
    state.photos[newIdx] = tmp;
    renderGrid();
    scheduleSave();
  }

  function deletePhoto(idx){
    if(!confirm("Supprimer cette photo du rapport ?")) return;
    state.photos.splice(idx, 1);
    renderGrid();
    scheduleSave();
  }

  function resizeImage(file){
    return new Promise(function(resolve, reject){
      var reader = new FileReader();
      reader.onerror = reject;
      reader.onload = function(e){
        var img = new Image();
        img.onerror = reject;
        img.onload = function(){
          var maxDim = 1600;
          var w = img.width, h = img.height;
          if(w > maxDim || h > maxDim){
            if(w >= h){ h = Math.round(h * maxDim / w); w = maxDim; }
            else { w = Math.round(w * maxDim / h); h = maxDim; }
          }
          var canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          var ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.78));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  elFileInput.addEventListener("change", function(e){
    var files = Array.prototype.slice.call(e.target.files || []);
    if(files.length === 0) return;
    showToast("Traitement de " + files.length + (files.length>1?" photos...":" photo..."));
    Promise.all(files.map(resizeImage)).then(function(dataUrls){
      dataUrls.forEach(function(dataUrl){
        state.photos.push({
          id: Date.now() + "-" + Math.random().toString(36).slice(2,8),
          dataUrl: dataUrl,
          comment: "",
          annotations: []
        });
      });
      renderGrid();
      scheduleSave();
      showToast(files.length + (files.length>1?" photos ajoutées":" photo ajoutée"));
      elFileInput.value = "";
    }).catch(function(){
      showToast("Erreur lors du chargement d'une photo");
      elFileInput.value = "";
    });
  });

  btnAdd.addEventListener("click", function(){ elFileInput.click(); });

  var btnExport = $("btn-export"), btnImport = $("btn-import"), elImportInput = $("import-input");

  btnExport.addEventListener("click", function(){
    if(state.photos.length === 0 && !state.projet){
      showToast("Rien à exporter pour l'instant");
      return;
    }
    var payload = {
      type: "rapport-photo-chantier",
      version: 1,
      exportedAt: new Date().toISOString(),
      projet: state.projet,
      date: state.date,
      lieu: state.lieu,
      auteur: state.auteur,
      layout: state.layout,
      photos: state.photos.map(function(p){
        return { id: p.id, dataUrl: p.dataUrl, comment: p.comment, annotations: p.annotations || [] };
      })
    };
    var blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var fname = "sauvegarde-" + (state.projet ? slugify(state.projet)+"-" : "") + (state.date || todayISO()) + ".json";

    try{
      var a = document.createElement("a");
      a.href = url; a.download = fname;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }catch(e){ console.error("Téléchargement auto impossible", e); }

    // Même bandeau de secours que pour le PDF, au cas où le téléchargement auto échoue
    var readyLink = $("pdf-ready-link");
    readyLink.href = url;
    readyLink.download = fname;
    readyLink.textContent = "💾 Ouvrir / enregistrer : " + fname;
    $("pdf-ready").classList.add("show");

    showToast("Sauvegarde prête — " + state.photos.length + (state.photos.length>1?" photos":" photo"));
  });

  btnImport.addEventListener("click", function(){ elImportInput.click(); });

  elImportInput.addEventListener("change", function(e){
    var file = e.target.files && e.target.files[0];
    if(!file) return;
    var reader = new FileReader();
    reader.onload = function(ev){
      var applyImport = function(data){
        state.projet = data.projet || "";
        state.date = data.date || todayISO();
        state.lieu = data.lieu || "";
        state.auteur = data.auteur || "";
        state.layout = data.layout || 4;
        state.photos = data.photos.map(function(p){
          return {
            id: p.id || (Date.now() + "-" + Math.random().toString(36).slice(2,8)),
            dataUrl: p.dataUrl,
            comment: p.comment || "",
            annotations: Array.isArray(p.annotations) ? p.annotations : []
          };
        });
        normalizeAnnotationSizes(state.photos);
        renderAll();
        persist();
        showToast("Sauvegarde importée — " + state.photos.length + (state.photos.length>1?" photos":" photo"));
      };
      try{
        var data = JSON.parse(ev.target.result);
        if(!data || !Array.isArray(data.photos)) throw new Error("Format invalide");
        if(state.photos.length > 0){
          if(confirm("Remplacer le rapport actuel par cette sauvegarde ? Le rapport en cours sera perdu.")){
            applyImport(data);
          }
        } else {
          applyImport(data);
        }
      }catch(err){
        console.error(err);
        showToast("Fichier de sauvegarde invalide");
      }
      elImportInput.value = "";
    };
    reader.onerror = function(){
      showToast("Erreur de lecture du fichier");
      elImportInput.value = "";
    };
    reader.readAsText(file);
  });

  btnReset.addEventListener("click", function(){
    if(state.photos.length === 0 && !state.projet && !state.lieu) return;
    if(!confirm("Démarrer un nouveau rapport ? Les photos et commentaires actuels seront effacés.")) return;
    state.projet = ""; state.lieu = ""; state.auteur = "";
    state.date = todayISO();
    state.photos = [];
    renderAll();
    persist();
    showToast("Nouveau rapport prêt");
  });

  [elProjet, elDate, elLieu, elAuteur].forEach(function(input){
    input.addEventListener("input", function(){
      state.projet = elProjet.value;
      state.date = elDate.value;
      state.lieu = elLieu.value;
      state.auteur = elAuteur.value;
      scheduleSave();
    });
  });

  Array.prototype.forEach.call(segmented.querySelectorAll("button"), function(b){
    b.addEventListener("click", function(){
      state.layout = Number(b.dataset.n);
      Array.prototype.forEach.call(segmented.querySelectorAll("button"), function(x){
        x.classList.toggle("active", x === b);
      });
      updateStatus();
      scheduleSave();
    });
  });

  function getImageDims(dataUrl){
    return new Promise(function(resolve, reject){
      var img = new Image();
      img.onload = function(){ resolve({w: img.width, h: img.height}); };
      img.onerror = function(){ reject(new Error("Image illisible")); };
      img.src = dataUrl;
    });
  }

  function gridFor(n){
    if(n === 1) return {cols:1, rows:1};
    if(n === 2) return {cols:1, rows:2};
    if(n === 4) return {cols:2, rows:2};
    return {cols:2, rows:3}; // 6
  }

  // ---------- Annotation (flèches & texte sur les photos) ----------

  function drawArrow(ctx, x1, y1, x2, y2, color, refW){
    var lw = Math.max(3, refW*0.009);
    var headLen = Math.max(16, refW*0.04);
    var angle = Math.atan2(y2-y1, x2-x1);

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // halo sombre pour la lisibilité sur tout type de fond
    ctx.lineWidth = lw + 3;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();

    // trait coloré
    ctx.lineWidth = lw;
    ctx.strokeStyle = color;
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();

    // pointe de flèche
    var p1x = x2 - headLen*Math.cos(angle-Math.PI/6);
    var p1y = y2 - headLen*Math.sin(angle-Math.PI/6);
    var p2x = x2 - headLen*Math.cos(angle+Math.PI/6);
    var p2y = y2 - headLen*Math.sin(angle+Math.PI/6);
    ctx.beginPath();
    ctx.moveTo(x2,y2); ctx.lineTo(p1x,p1y); ctx.lineTo(p2x,p2y); ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.stroke();
  }

  function wrapCanvasText(ctx, text, maxWidth){
    var words = text.split(/\s+/).filter(Boolean);
    var lines = [];
    var current = "";
    words.forEach(function(w){
      var test = current ? current + " " + w : w;
      if(current && ctx.measureText(test).width > maxWidth){
        lines.push(current);
        current = w;
      } else {
        current = test;
      }
    });
    if(current) lines.push(current);
    return lines.length ? lines : [text];
  }

  function drawAnnotText(ctx, text, x, y, color, fontPx, canvasW, canvasH){
    ctx.font = "800 " + fontPx + "px Arial, sans-serif";
    ctx.textBaseline = "top";
    var pad = Math.max(4, fontPx * 0.3);
    var maxWidth = canvasW ? Math.max(canvasW - pad*2, fontPx*2) : Infinity;
    var lines = wrapCanvasText(ctx, text, maxWidth);
    var lineHeight = fontPx * 1.25;

    var maxLineWidth = 0;
    lines.forEach(function(line){
      maxLineWidth = Math.max(maxLineWidth, ctx.measureText(line).width);
    });

    // Garde tout le bloc de texte visible à l'intérieur de la photo
    if(canvasW){
      if(x + maxLineWidth + pad > canvasW) x = canvasW - maxLineWidth - pad;
      if(x < pad) x = pad;
    }
    var totalHeight = lineHeight * lines.length;
    if(canvasH){
      if(y + totalHeight + pad > canvasH) y = canvasH - totalHeight - pad;
      if(y < pad) y = pad;
    }

    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(3, fontPx*0.16);
    lines.forEach(function(line, i){
      var ly = y + i*lineHeight;
      ctx.strokeStyle = "rgba(0,0,0,0.65)";
      ctx.strokeText(line, x, ly);
      ctx.fillStyle = color;
      ctx.fillText(line, x, ly);
    });
  }

  function paintAnnotations(ctx, annotations, canvasW, canvasH){
    // On se base sur la plus grande dimension (et non la largeur) pour que
    // le texte et les flèches gardent la même taille visuelle, que la photo
    // soit en format portrait ou paysage.
    var refDim = Math.max(canvasW, canvasH);
    (annotations||[]).forEach(function(a){
      if(a.type === "arrow"){
        drawArrow(ctx, a.x1*canvasW, a.y1*canvasH, a.x2*canvasW, a.y2*canvasH, a.color, refDim);
      } else if(a.type === "text"){
        drawAnnotText(ctx, a.text, a.x*canvasW, a.y*canvasH, a.color, a.fontSize*refDim, canvasW, canvasH);
      }
    });
  }

  // Fusionne la photo d'origine + ses annotations dans un dataURL (utilisé pour
  // les vignettes et l'export PDF). Résultat mis en cache tant que non invalidé.
  function getComposedDataUrl(photo){
    if(!photo.annotations || photo.annotations.length === 0){
      return Promise.resolve(photo.dataUrl);
    }
    if(photo._renderedDataUrl){
      return Promise.resolve(photo._renderedDataUrl);
    }
    return new Promise(function(resolve){
      var img = new Image();
      img.onload = function(){
        var canvas = document.createElement("canvas");
        canvas.width = img.width; canvas.height = img.height;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        paintAnnotations(ctx, photo.annotations, canvas.width, canvas.height);
        var out = canvas.toDataURL("image/jpeg", 0.85);
        photo._renderedDataUrl = out;
        resolve(out);
      };
      img.onerror = function(){ resolve(photo.dataUrl); };
      img.src = photo.dataUrl;
    });
  }

  var elAnnotateModal = $("annotate-modal");
  var elAnnotateCanvas = $("annotate-canvas");
  var elAnnotateTitle = $("annotate-title");
  var elAnnotateTextEntry = $("annotate-text-entry");
  var elAnnotateTextInput = $("annotate-text-input");
  var annotateState = {
    photo: null,
    temp: [],
    tool: "arrow",
    color: "#F2B705",
    img: null,
    dragging: false,
    pendingTextPos: null,
    startX: 0, startY: 0, curX: 0, curY: 0
  };

  function openAnnotator(photo, idx){
    annotateState.photo = photo;
    annotateState.temp = (photo.annotations || []).map(function(a){ return Object.assign({}, a); });
    annotateState.tool = "arrow";
    annotateState.color = "#F2B705";
    annotateState.dragging = false;
    elAnnotateTitle.textContent = "Annoter — Photo " + (idx+1);

    Array.prototype.forEach.call(elAnnotateModal.querySelectorAll(".ann-tool"), function(b){
      b.classList.toggle("active", b.dataset.tool === "arrow");
    });
    Array.prototype.forEach.call(elAnnotateModal.querySelectorAll(".ann-color"), function(b){
      b.classList.toggle("active", b.dataset.color === "#F2B705");
    });

    var img = new Image();
    img.onload = function(){
      annotateState.img = img;
      elAnnotateCanvas.width = img.width;
      elAnnotateCanvas.height = img.height;
      drawAnnotatorFrame();
      elAnnotateModal.classList.add("show");
    };
    img.onerror = function(){ showToast("Impossible de charger la photo"); };
    img.src = photo.dataUrl;
  }

  function closeTextEntry(){
    elAnnotateTextEntry.classList.remove("show");
    elAnnotateTextInput.blur();
    annotateState.pendingTextPos = null;
  }

  function closeAnnotator(){
    elAnnotateModal.classList.remove("show");
    closeTextEntry();
    annotateState.photo = null;
    annotateState.img = null;
    annotateState.temp = [];
  }

  function drawAnnotatorFrame(previewDrag){
    if(!annotateState.img) return;
    var ctx = elAnnotateCanvas.getContext("2d");
    var w = elAnnotateCanvas.width, h = elAnnotateCanvas.height;
    ctx.clearRect(0,0,w,h);
    ctx.drawImage(annotateState.img, 0, 0, w, h);
    paintAnnotations(ctx, annotateState.temp, w, h);
    if(previewDrag && annotateState.dragging){
      drawArrow(ctx, annotateState.startX, annotateState.startY, annotateState.curX, annotateState.curY, annotateState.color, Math.max(w,h));
    }
  }

  function getCanvasPos(e){
    var rect = elAnnotateCanvas.getBoundingClientRect();
    var scaleX = elAnnotateCanvas.width / rect.width;
    var scaleY = elAnnotateCanvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  elAnnotateCanvas.addEventListener("pointerdown", function(e){
    if(!annotateState.img) return;
    e.preventDefault();
    var pos = getCanvasPos(e);
    if(annotateState.tool === "text"){
      annotateState.pendingTextPos = pos;
      elAnnotateTextInput.value = "";
      elAnnotateTextEntry.classList.add("show");
      // Le focus doit être déclenché de façon synchrone, dans le même geste
      // tactile, pour que le clavier iOS s'ouvre de manière fiable.
      elAnnotateTextInput.focus();
      return;
    }
    annotateState.dragging = true;
    annotateState.startX = pos.x; annotateState.startY = pos.y;
    annotateState.curX = pos.x; annotateState.curY = pos.y;
  });

  elAnnotateCanvas.addEventListener("pointermove", function(e){
    if(!annotateState.dragging) return;
    e.preventDefault();
    var pos = getCanvasPos(e);
    annotateState.curX = pos.x; annotateState.curY = pos.y;
    drawAnnotatorFrame(true);
  });

  function finishArrowDrag(){
    if(!annotateState.dragging) return;
    annotateState.dragging = false;
    var dx = annotateState.curX - annotateState.startX;
    var dy = annotateState.curY - annotateState.startY;
    if(Math.hypot(dx,dy) > 10){
      annotateState.temp.push({
        type: "arrow",
        x1: annotateState.startX / elAnnotateCanvas.width,
        y1: annotateState.startY / elAnnotateCanvas.height,
        x2: annotateState.curX / elAnnotateCanvas.width,
        y2: annotateState.curY / elAnnotateCanvas.height,
        color: annotateState.color
      });
    }
    drawAnnotatorFrame();
  }
  elAnnotateCanvas.addEventListener("pointerup", finishArrowDrag);
  elAnnotateCanvas.addEventListener("pointercancel", finishArrowDrag);

  Array.prototype.forEach.call(elAnnotateModal.querySelectorAll(".ann-tool"), function(b){
    b.addEventListener("click", function(){
      annotateState.tool = b.dataset.tool;
      Array.prototype.forEach.call(elAnnotateModal.querySelectorAll(".ann-tool"), function(x){
        x.classList.toggle("active", x === b);
      });
    });
  });

  Array.prototype.forEach.call(elAnnotateModal.querySelectorAll(".ann-color"), function(b){
    b.addEventListener("click", function(){
      annotateState.color = b.dataset.color;
      Array.prototype.forEach.call(elAnnotateModal.querySelectorAll(".ann-color"), function(x){
        x.classList.toggle("active", x === b);
      });
    });
  });

  $("annotate-undo").addEventListener("click", function(){
    annotateState.temp.pop();
    drawAnnotatorFrame();
  });

  $("annotate-clear").addEventListener("click", function(){
    if(annotateState.temp.length === 0) return;
    if(!confirm("Effacer toutes les annotations de cette photo ?")) return;
    annotateState.temp = [];
    drawAnnotatorFrame();
  });

  function confirmTextEntry(){
    var txt = elAnnotateTextInput.value.trim();
    if(txt && annotateState.pendingTextPos){
      annotateState.temp.push({
        type: "text",
        x: annotateState.pendingTextPos.x / elAnnotateCanvas.width,
        y: annotateState.pendingTextPos.y / elAnnotateCanvas.height,
        text: txt,
        color: annotateState.color,
        fontSize: DEFAULT_TEXT_SIZE
      });
      drawAnnotatorFrame();
    }
    closeTextEntry();
  }

  $("annotate-text-confirm").addEventListener("click", confirmTextEntry);
  $("annotate-text-cancel-entry").addEventListener("click", closeTextEntry);
  elAnnotateTextInput.addEventListener("keydown", function(e){
    if(e.key === "Enter"){
      e.preventDefault();
      confirmTextEntry();
    }
  });

  $("annotate-cancel").addEventListener("click", function(){
    closeAnnotator();
  });

  $("annotate-save").addEventListener("click", function(){
    if(!annotateState.photo) return;
    annotateState.photo.annotations = annotateState.temp.map(function(a){ return Object.assign({}, a); });
    annotateState.photo._renderedDataUrl = null;
    closeAnnotator();
    renderGrid();
    scheduleSave();
    showToast("Annotations enregistrées");
  });

  async function generatePdf(){
    if(state.photos.length === 0) return;
    btnPdf.disabled = true;
    var origLabel = btnPdf.innerHTML;
    btnPdf.innerHTML = '<span class="icon">⏳</span><span>Génération...</span>';
    try{
      var jsPDFCtor = (window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : window.jsPDF;
      var doc = new jsPDFCtor({ unit: "mm", format: "a4", orientation: "portrait" });

      var pageW = 210, pageH = 297, margin = 10;
      var headerBandH = 26;
      var contentTop = headerBandH + 6;
      var contentW = pageW - margin*2;
      var contentH = pageH - contentTop - margin;
      var gap = 6;

      var grid = gridFor(state.layout);
      var perPage = state.layout;
      var totalPages = Math.ceil(state.photos.length / perPage);

      var cellW = (contentW - gap*(grid.cols-1)) / grid.cols;
      var cellH = (contentH - gap*(grid.rows-1)) / grid.rows;
      var imgAreaRatio = 0.72;

      var projetLabel = state.projet || "Rapport de chantier";
      var dateLabel = state.date ? formatDateFR(state.date) : "";
      var lieuLabel = state.lieu || "";
      var auteurLabel = state.auteur || "";
      var maxHeaderWidth = pageW - margin*2;

      function truncateToWidth(text, maxWidth){
        if(doc.getTextWidth(text) <= maxWidth) return text;
        var t = text;
        while(t.length > 1 && doc.getTextWidth(t + "...") > maxWidth){
          t = t.slice(0, -1);
        }
        return t + "...";
      }

      for(var p=0; p<totalPages; p++){
        if(p>0) doc.addPage();

        // Bande d'en-tête
        doc.setFillColor(35,38,43);
        doc.rect(0, 0, pageW, headerBandH, "F");
        doc.setDrawColor(242,183,5);
        doc.setLineWidth(1.2);
        doc.line(0, headerBandH, pageW, headerBandH);

        // Titre du projet — enroulé sur 2 lignes max, sans chevaucher quoi que ce soit
        doc.setTextColor(245,243,239);
        doc.setFont("helvetica","bold");
        doc.setFontSize(13);
        var titleLines = doc.splitTextToSize(projetLabel, maxHeaderWidth);
        if(titleLines.length > 2){
          titleLines = titleLines.slice(0,2);
          titleLines[1] = truncateToWidth(titleLines[1], maxHeaderWidth);
        }
        if(titleLines.length === 1){
          doc.text(titleLines[0], margin, 13);
        } else {
          doc.text(titleLines[0], margin, 9.5);
          doc.text(titleLines[1], margin, 15);
        }

        // Sous-titre (lieu · date · auteur) — sur une seule ligne, tronqué si trop long
        doc.setFont("helvetica","normal");
        doc.setFontSize(8.5);
        var subParts = [];
        if(lieuLabel) subParts.push(lieuLabel);
        if(dateLabel) subParts.push(dateLabel);
        if(auteurLabel) subParts.push("Par " + auteurLabel);
        var subtitleText = subParts.join("   ·   ");
        if(subtitleText){
          doc.text(truncateToWidth(subtitleText, maxHeaderWidth), margin, 21.5);
        }

        // Pied de page — pagination, jamais en collision avec le titre
        doc.setFont("helvetica","normal");
        doc.setFontSize(8);
        doc.setTextColor(140,138,132);
        doc.text("Page " + (p+1) + " / " + totalPages, pageW-margin, pageH-5, {align:"right"});

        // Cells
        var startIdx = p*perPage;
        var pagePhotos = state.photos.slice(startIdx, startIdx+perPage);

        for(var i=0;i<pagePhotos.length;i++){
          var col = i % grid.cols;
          var row = Math.floor(i / grid.cols);
          var cellX = margin + col*(cellW+gap);
          var cellY = contentTop + row*(cellH+gap);

          var imgAreaH = cellH * imgAreaRatio;
          var txtAreaH = cellH - imgAreaH - 2;

          // frame
          doc.setDrawColor(190,186,178);
          doc.setLineWidth(0.3);
          doc.setFillColor(255,255,255);
          doc.rect(cellX, cellY, cellW, imgAreaH, "FD");

          var photo = pagePhotos[i];
          var sourceUrl = await getComposedDataUrl(photo);
          var dims = await getImageDims(sourceUrl);
          var ratio = dims.w / dims.h;
          var boxRatio = cellW / imgAreaH;
          var drawW, drawH;
          if(ratio > boxRatio){
            drawW = cellW; drawH = cellW / ratio;
          } else {
            drawH = imgAreaH; drawW = imgAreaH * ratio;
          }
          var drawX = cellX + (cellW - drawW)/2;
          var drawY = cellY + (imgAreaH - drawH)/2;
          try{
            doc.addImage(sourceUrl, "JPEG", drawX, drawY, drawW, drawH, undefined, "FAST");
          }catch(e){ console.error("addImage error", e); }

          // number badge
          doc.setFillColor(242,183,5);
          doc.circle(cellX+6, cellY+6, 4, "F");
          doc.setTextColor(58,46,0);
          doc.setFont("helvetica","bold");
          doc.setFontSize(8);
          doc.text(String(startIdx+i+1).padStart(2,"0"), cellX+6, cellY+7.3, {align:"center"});

          // comment
          var textY = cellY + imgAreaH + 5;
          doc.setTextColor(26,26,26);
          doc.setFont("helvetica","bold");
          doc.setFontSize(8);
          doc.text("Photo " + (startIdx+i+1), cellX, textY);
          doc.setFont("helvetica","normal");
          doc.setFontSize(8.3);
          var comment = (photo.comment || "").trim() || "—";
          var maxLines = Math.max(1, Math.floor((txtAreaH-4) / 3.6));
          var lines = doc.splitTextToSize(comment, cellW);
          if(lines.length > maxLines){
            lines = lines.slice(0, maxLines);
            var last = lines[lines.length-1];
            lines[lines.length-1] = last.length > 3 ? last.slice(0, last.length-3) + "..." : last;
          }
          doc.text(lines, cellX, textY+4);
        }
      }

      var fname = "rapport-photo-" + (state.projet ? slugify(state.projet)+"-" : "") + (state.date || todayISO()) + ".pdf";

      var blob = doc.output("blob");
      var url = URL.createObjectURL(blob);

      // Tentative de téléchargement automatique (fonctionne sur la plupart des navigateurs desktop/Android)
      try{
        var a = document.createElement("a");
        a.href = url;
        a.download = fname;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }catch(autoErr){
        console.error("Téléchargement auto impossible", autoErr);
      }

      // Lien de secours toujours affiché : certains navigateurs mobiles bloquent
      // le téléchargement automatique, ce lien permet de l'ouvrir/enregistrer manuellement.
      var readyBanner = $("pdf-ready");
      var readyLink = $("pdf-ready-link");
      readyLink.href = url;
      readyLink.download = fname;
      readyLink.textContent = "📄 Ouvrir / enregistrer : " + fname;
      readyBanner.classList.add("show");

      showToast("PDF prêt — " + totalPages + (totalPages>1?" pages":" page"));
    }catch(err){
      console.error(err);
      showToast("Erreur PDF : " + (err && err.message ? err.message : "erreur inconnue"));
    } finally {
      btnPdf.disabled = state.photos.length === 0;
      btnPdf.innerHTML = origLabel;
    }
  }

  $("pdf-ready-close").addEventListener("click", function(){
    $("pdf-ready").classList.remove("show");
  });

  function slugify(s){
    return s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"").slice(0,40);
  }

  function formatDateFR(iso){
    var parts = iso.split("-");
    if(parts.length !== 3) return iso;
    return parts[2] + "/" + parts[1] + "/" + parts[0];
  }

  btnPdf.addEventListener("click", generatePdf);

  load();
})();

