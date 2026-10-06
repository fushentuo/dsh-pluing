window.__ModuleLoader__.load({
  id: "@deepseek-ai/dsh-background-wallpaper",
  factory: function (require) {
    "use strict";
    var module = { exports: {} };
    var exports = module.exports;

    var React = require("react");

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------
    var STORAGE_KEY = "dsh-background-wallpaper:state:v1";
    // Bumped whenever the stored shape changes so legacy records can be told
    // apart from real user choices.
    var STATE_VERSION = 3;
    var SOURCE_ID = "@deepseek-ai/dsh-background-wallpaper";
    var LAYER_ID = "dsh-background-wallpaper-layer";

    // IndexedDB keeps the actual image/video asset (Blob), which survives app
    // restarts and is not subject to localStorage's ~5MB quota.
    var IDB_NAME = "dsh-background-wallpaper";
    var IDB_VERSION = 1;
    var IDB_STORE = "assets";
    var IDB_KEY = "background";

    // Theme tokens that paint the app's background surfaces. Making them
    // semi-transparent is what lets the wallpaper show through the UI
    // (the "image behind text" effect), while text/controls stay opaque.
    var OPACITY_TOKENS = [
      "--dsw-alias-bg-base",
      "--dsw-alias-bg-layer-1",
      "--dsw-alias-bg-layer-2",
      "--dsw-alias-bg-overlay",
      "--dsw-specific-sidebar-fill"
    ];

    // ---------------------------------------------------------------------
    // Small helpers
    // ---------------------------------------------------------------------
    function clamp(n, min, max) {
      return Math.min(max, Math.max(min, n));
    }

    function hexToRgb(hex) {
      var s = String(hex || "").replace(/#/g, "").trim();
      if (s.length === 3) s = s.split("").map(function (c) { return c + c; }).join("");
      if (s.length !== 6) return null;
      var n = parseInt(s, 16);
      if (isNaN(n)) return null;
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }

    function parseRgbString(str) {
      var m = String(str || "").match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
      if (!m) return null;
      return {
        r: clamp(Math.round(parseFloat(m[1])), 0, 255),
        g: clamp(Math.round(parseFloat(m[2])), 0, 255),
        b: clamp(Math.round(parseFloat(m[3])), 0, 255)
      };
    }

    // Convert a concrete CSS colour (hex / rgb / rgba) to rgba with the given
    // alpha. Falls back to the raw value when it cannot be parsed.
    function withAlpha(color, alpha) {
      var rgb = hexToRgb(color) || parseRgbString(color);
      if (!rgb) return color;
      return "rgba(" + rgb.r + ", " + rgb.g + ", " + rgb.b + ", " + alpha + ")";
    }

    // Escape a URL so it is safe inside a CSS url("…") token.
    function cssUrl(src) {
      return 'url("' + String(src).replace(/["\\]/g, "\\$&") + '")';
    }

    // ---------------------------------------------------------------------
    // IndexedDB persistence for the background asset (Blob).
    // ---------------------------------------------------------------------
    function idbOpen() {
      return new Promise(function (resolve, reject) {
        if (typeof indexedDB === "undefined") {
          reject(new Error("IndexedDB unavailable"));
          return;
        }
        var req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    }

    function idbSetAsset(blob) {
      return idbOpen().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(IDB_STORE, "readwrite");
          tx.objectStore(IDB_STORE).put(blob, IDB_KEY);
          tx.oncomplete = function () { db.close(); resolve(); };
          tx.onerror = function () { db.close(); reject(tx.error); };
        });
      });
    }

    function idbGetAsset() {
      return idbOpen().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(IDB_STORE, "readonly");
          var req = tx.objectStore(IDB_STORE).get(IDB_KEY);
          req.onsuccess = function () { db.close(); resolve(req.result || null); };
          req.onerror = function () { db.close(); reject(req.error); };
        });
      });
    }

    function idbDeleteAsset() {
      return idbOpen().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(IDB_STORE, "readwrite");
          tx.objectStore(IDB_STORE).delete(IDB_KEY);
          tx.oncomplete = function () { db.close(); resolve(); };
          tx.onerror = function () { db.close(); reject(tx.error); };
        });
      });
    }

    // ---------------------------------------------------------------------
    // Metadata state (localStorage) — small values only; the asset Blob lives
    // in IndexedDB so it survives restarts regardless of size.
    //   type    : null | "image" | "video"
    //   opacity : 0..100
    //   fit     : fill (铺满) / contain (完整) / cover (裁剪)
    // ---------------------------------------------------------------------
    function normalizeFit(value) {
      return value === "cover" || value === "contain" ? value : "fill";
    }

    function loadState() {
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { type: null, src: null, opacity: 100, fit: "fill" };
        var p = JSON.parse(raw);
        var type = p.type === "video" ? "video" : p.type === "image" ? "image" : null;
        return {
          type: type,
          // src is never persisted; it is re-created as an object URL from the
          // IndexedDB Blob after load.
          src: null,
          opacity: typeof p.opacity === "number" ? clamp(p.opacity, 0, 100) : 100,
          fit: p.v === STATE_VERSION ? normalizeFit(p.fit) : "fill"
        };
      } catch (e) {
        return { type: null, src: null, opacity: 100, fit: "fill" };
      }
    }

    function saveState(state) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          type: state.type,
          opacity: state.opacity,
          fit: state.fit,
          v: STATE_VERSION
        }));
      } catch (e) {
        /* ignore */
      }
    }

    // ---------------------------------------------------------------------
    // Static stylesheet (injected once, removed on unload). The layer's own
    // background colour is appended at runtime from the live theme palette so
    // letterbox bars match the active light/dark scheme.
    // ---------------------------------------------------------------------
    var CSS_TEXT = [
      "#dsh-background-wallpaper-layer{position:fixed;inset:0;z-index:-1;overflow:hidden;pointer-events:none}",
      ".dsh-bg-backdrop{position:absolute;inset:0;background-position:center;background-size:cover;background-repeat:no-repeat;transform:scale(1.2);filter:blur(52px) brightness(.72) saturate(1.25);opacity:0;transition:opacity .25s ease}",
      ".dsh-bg-backdrop.dsh-bg-backdrop-on{opacity:1}",
      ".dsh-bg-media{position:absolute;inset:0}",
      ".dsh-bg-image,.dsh-bg-video{width:100%;height:100%;display:block}",
      "html,body{background:transparent!important}",
      ".dsh-bg-fab{position:fixed;right:24px;bottom:24px;z-index:99999;display:flex;flex-direction:column;align-items:flex-end;gap:12px;font-family:var(--dsw-font-family,system-ui);pointer-events:auto}",
      ".dsh-bg-fab-button{width:44px;height:44px;border-radius:50%;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));background:var(--dsw-alias-bg-layer-1,rgba(40,40,44,.92));color:var(--dsw-alias-label-primary,#eee);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.35);transition:transform .15s ease}",
      ".dsh-bg-fab-button:hover{transform:translateY(-1px)}",
      ".dsh-bg-panel{background:var(--dsw-alias-bg-overlay,#232325);color:var(--dsw-alias-label-primary,#eee);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:14px;box-shadow:0 12px 32px rgba(0,0,0,.35);padding:16px;width:308px;display:flex;flex-direction:column;gap:12px;backdrop-filter:blur(14px)}",
      ".dsh-bg-panel-title{font-size:14px;font-weight:600;margin:0}",
      ".dsh-bg-row{display:flex;align-items:center;gap:8px}",
      ".dsh-bg-label{flex:1;font-size:13px;color:var(--dsw-alias-label-primary,#eee)}",
      ".dsh-bg-btn{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.08));color:var(--dsw-alias-label-primary,#eee);border-radius:8px;padding:8px 12px;font-size:13px;cursor:pointer}",
      ".dsh-bg-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.12))}",
      ".dsh-bg-btn-danger{color:#fff;background:rgba(220,80,80,.85)}",
      ".dsh-bg-btn-danger:hover{background:rgba(220,80,80,1)}",
      ".dsh-bg-slider{width:100%;accent-color:var(--dsw-alias-brand-primary,#4d6bfe)}",
      ".dsh-bg-value{font-variant-numeric:tabular-nums;font-size:12px;color:var(--dsw-alias-label-secondary,#9aa);min-width:36px;text-align:right}",
      ".dsh-bg-seg{display:flex;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));border-radius:8px;overflow:hidden}",
      ".dsh-bg-seg button{flex:1;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#9aa);padding:7px 0;font:inherit;font-size:12px;cursor:pointer}",
      ".dsh-bg-seg button+button{border-left:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16))}",
      ".dsh-bg-seg button.dsh-bg-seg-on{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.14));color:var(--dsw-alias-label-primary,#eee)}",
      ".dsh-bg-hint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#9aa);margin:0}"
    ].join("\n");

    // ---------------------------------------------------------------------
    // Client plugin
    // ---------------------------------------------------------------------
    var inject = ["slots", "theme"];

    function apply(ctx) {
      if (typeof document === "undefined") return;

      var body = document.body;

      // 1. Read the light+dark values of each background token ONCE, so the
      // opacity override carries correct per-scheme colours and the theme
      // service can switch palettes itself (no re-apply listener => no loop).
      var tokenPalette = readTokenPalette();

      function readTokenPalette() {
        var palette = {};
        try {
          for (var i = 0; i < OPACITY_TOKENS.length; i++) {
            var name = OPACITY_TOKENS[i];
            var pair = readTokenPair(name);
            if (pair.light || pair.dark) palette[name] = pair;
          }
        } catch (e) {
          palette = {};
        }
        return palette;
      }

      function readTokenPair(name) {
        var had = body.hasAttribute("data-ds-dark-theme");
        try {
          body.removeAttribute("data-ds-dark-theme");
          var light = getComputedStyle(body).getPropertyValue(name).trim();
          body.setAttribute("data-ds-dark-theme", "");
          var dark = getComputedStyle(body).getPropertyValue(name).trim();
          if (!light && dark) light = dark;
          if (!dark && light) dark = light;
          return { light: light, dark: dark };
        } finally {
          if (had) body.setAttribute("data-ds-dark-theme", "");
          else body.removeAttribute("data-ds-dark-theme");
        }
      }

      // 2. Inject the stylesheet, including the layer's letterbox colour taken
      // from the live palette so bars match the active light/dark scheme.
      var basePair = tokenPalette["--dsw-alias-bg-base"] || {};
      var layerBgCss =
        "#dsh-background-wallpaper-layer{background:" + (basePair.light || "#ffffff") + "}" +
        "body[data-ds-dark-theme] #dsh-background-wallpaper-layer{background:" + (basePair.dark || "#151517") + "}";

      var style = document.createElement("style");
      style.dataset.plugin = SOURCE_ID;
      style.textContent = CSS_TEXT + "\n" + layerBgCss;
      document.head.appendChild(style);

      // 3. Full-screen background layer: a blurred backdrop plus the media.
      var layer = document.createElement("div");
      layer.id = LAYER_ID;
      layer.setAttribute("aria-hidden", "true");
      var backdrop = document.createElement("div");
      backdrop.className = "dsh-bg-backdrop";
      var media = document.createElement("div");
      media.className = "dsh-bg-media";
      layer.appendChild(backdrop);
      layer.appendChild(media);
      body.appendChild(layer);

      var opacityDispose = null;
      var appliedAlpha = null; // alpha currently stacked (null => opaque, no layer)

      // 4. Render the current wallpaper.
      //    fill    -> the COMPLETE image is scaled onto the viewport (default).
      //    contain -> complete image at its own ratio; the gaps are filled by a
      //               blurred copy of the same image (images) or the theme colour.
      //    cover   -> full-bleed, cropping the overflow.
      function renderMedia(type, src, fit) {
        media.innerHTML = "";
        backdrop.style.backgroundImage = "";
        backdrop.classList.remove("dsh-bg-backdrop-on");
        if (!src) return;

        var isVideo = type === "video";
        var el;
        if (isVideo) {
          el = document.createElement("video");
          el.src = src;
          el.autoplay = true;
          el.muted = true;
          el.loop = true;
          el.playsInline = true;
          el.className = "dsh-bg-video";
        } else {
          el = document.createElement("img");
          el.src = src;
          el.alt = "";
          el.className = "dsh-bg-image";
        }
        el.style.objectFit = fit;
        media.appendChild(el);
        if (isVideo) el.play().catch(function () { /* autoplay blocked; frame still shows */ });

        // Only "contain" leaves visible gaps worth filling with the blur.
        if (fit === "contain" && !isVideo) {
          backdrop.style.backgroundImage = cssUrl(src);
          backdrop.classList.add("dsh-bg-backdrop-on");
        }
      }

      // 5. Apply interface opacity by stacking a theme-token override layer.
      // Idempotent: re-applying the same alpha is a no-op, so repeated slider
      // moves never re-publish or fight.
      function setOpacity(percent) {
        var alpha = clamp(Number(percent) || 0, 0, 100) / 100;
        if (alpha === appliedAlpha) return;
        if (opacityDispose) {
          opacityDispose();
          opacityDispose = null;
        }
        appliedAlpha = null;
        if (alpha >= 0.999) return; // fully opaque => no override needed

        if (Object.keys(tokenPalette).length === 0) {
          tokenPalette = readTokenPalette();
        }

        var tokens = {};
        for (var name in tokenPalette) {
          var pair = tokenPalette[name];
          tokens[name] = {
            light: pair.light ? withAlpha(pair.light, alpha) : pair.light,
            dark: pair.dark ? withAlpha(pair.dark, alpha) : pair.dark
          };
        }
        if (Object.keys(tokens).length > 0) {
          appliedAlpha = alpha;
          opacityDispose = ctx.theme.overrideTokens(SOURCE_ID, tokens);
        }
      }

      // 6. Cleanup on unload.
      ctx.effect(function () {
        return function () {
          if (style.parentNode) style.parentNode.removeChild(style);
          if (layer.parentNode) layer.parentNode.removeChild(layer);
          if (opacityDispose) opacityDispose();
        };
      }, SOURCE_ID + ": background layer cleanup");

      // 7. Floating control (icon + panel) into shell.overlay.
      function BackgroundControl() {
        var stateTuple = React.useState(loadState());
        var state = stateTuple[0];
        var setState = stateTuple[1];
        var openTuple = React.useState(false);
        var open = openTuple[0];
        var setOpen = openTuple[1];
        var imageInput = React.useRef(null);
        var videoInput = React.useRef(null);
        var currentObjectUrl = React.useRef(null);

        // Restore the persisted background Blob from IndexedDB once on mount.
        React.useEffect(function () {
          var cancelled = false;
          if (!state.type) return;
          idbGetAsset().then(function (blob) {
            if (cancelled) return;
            if (!blob) {
              // Metadata says there is a background but the asset is gone.
              setState(function (s) { return { type: null, src: null, opacity: s.opacity, fit: s.fit }; });
              return;
            }
            var url = URL.createObjectURL(blob);
            setState(function (s) { return { type: s.type, src: url, opacity: s.opacity, fit: s.fit }; });
          }).catch(function () { /* ignore */ });
          return function () { cancelled = true; };
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, []);

        // Render the media only when the source or fill mode changes — NOT on
        // every opacity tick. Also revoke the previous object URL.
        React.useEffect(function () {
          if (currentObjectUrl.current && currentObjectUrl.current !== state.src) {
            try { URL.revokeObjectURL(currentObjectUrl.current); } catch (e) { /* ignore */ }
          }
          currentObjectUrl.current = state.src;
          renderMedia(state.type, state.src, state.fit);
        }, [state.type, state.src, state.fit]);

        // Apply interface opacity independently of the media.
        React.useEffect(function () {
          setOpacity(state.opacity);
        }, [state.opacity]);

        // Persist metadata on any change (the asset itself is written to
        // IndexedDB at pick time).
        React.useEffect(function () {
          saveState(state);
        }, [state.type, state.opacity, state.fit]);

        // Revoke the object URL on unmount.
        React.useEffect(function () {
          return function () {
            if (currentObjectUrl.current) {
              try { URL.revokeObjectURL(currentObjectUrl.current); } catch (e) { /* ignore */ }
            }
          };
        }, []);

        function patch(part) {
          setState(function (s) {
            return {
              type: Object.prototype.hasOwnProperty.call(part, "type") ? part.type : s.type,
              src: Object.prototype.hasOwnProperty.call(part, "src") ? part.src : s.src,
              opacity: Object.prototype.hasOwnProperty.call(part, "opacity") ? part.opacity : s.opacity,
              fit: Object.prototype.hasOwnProperty.call(part, "fit") ? part.fit : s.fit
            };
          });
        }

        function applyPickedAsset(type, file) {
          var url = URL.createObjectURL(file);
          setState(function (s) {
            return { type: type, src: url, opacity: s.opacity === 100 ? 50 : s.opacity, fit: s.fit };
          });
          // Persist the raw file to IndexedDB (survives restarts, no quota limit).
          idbSetAsset(file).catch(function () { /* persistence failed; still shown this session */ });
        }

        function onPickImage(e) {
          var file = e.target.files && e.target.files[0];
          if (!file) return;
          applyPickedAsset("image", file);
          e.target.value = "";
        }

        function onPickVideo(e) {
          var file = e.target.files && e.target.files[0];
          if (!file) return;
          applyPickedAsset("video", file);
          e.target.value = "";
        }

        function onClear() {
          idbDeleteAsset().catch(function () { /* ignore */ });
          // No wallpaper => restore a fully opaque (normal-looking) interface.
          patch({ type: null, src: null, opacity: 100 });
        }

        function segButton(value, text) {
          return React.createElement(
            "button",
            {
              type: "button",
              className: state.fit === value ? "dsh-bg-seg-on" : "",
              onClick: function () { patch({ fit: value }); }
            },
            text
          );
        }

        var icon = React.createElement(
          "svg",
          { width: "20", height: "20", viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" },
          React.createElement("rect", { x: 3, y: 3, width: 18, height: 18, rx: 4, stroke: "currentColor", strokeWidth: 2 }),
          React.createElement("circle", { cx: 8.5, cy: 8.5, r: 1.5, fill: "currentColor" }),
          React.createElement("path", { d: "M21 15.5l-4.5-4.5L6 21.5", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" })
        );

        return React.createElement(
          "div",
          { className: "dsh-bg-fab" },
          open
            ? React.createElement(
                "div",
                { className: "dsh-bg-panel" },
                React.createElement("div", { className: "dsh-bg-panel-title" }, "背景壁纸"),
                React.createElement(
                  "div",
                  { className: "dsh-bg-row" },
                  React.createElement(
                    "button",
                    { type: "button", className: "dsh-bg-btn", onClick: function () { imageInput.current && imageInput.current.click(); } },
                    "选择图片"
                  ),
                  React.createElement(
                    "button",
                    { type: "button", className: "dsh-bg-btn", onClick: function () { videoInput.current && videoInput.current.click(); } },
                    "选择视频"
                  )
                ),
                React.createElement("div", { className: "dsh-bg-row" }, React.createElement("span", { className: "dsh-bg-label" }, "填充方式")),
                React.createElement(
                  "div",
                  { className: "dsh-bg-seg" },
                  segButton("fill", "铺满"),
                  segButton("contain", "完整"),
                  segButton("cover", "裁剪")
                ),
                React.createElement(
                  "div",
                  { className: "dsh-bg-row" },
                  React.createElement("span", { className: "dsh-bg-label" }, "界面不透明度"),
                  React.createElement("span", { className: "dsh-bg-value" }, state.opacity + "%")
                ),
                React.createElement("input", {
                  type: "range",
                  className: "dsh-bg-slider",
                  min: "0",
                  max: "100",
                  step: "1",
                  value: state.opacity,
                  onChange: function (e) { patch({ opacity: clamp(Number(e.target.value) || 0, 0, 100) }); },
                  "aria-label": "界面不透明度"
                }),
                React.createElement(
                  "div",
                  { className: "dsh-bg-row" },
                  React.createElement(
                    "button",
                    { type: "button", className: "dsh-bg-btn dsh-bg-btn-danger", onClick: onClear, disabled: !state.src },
                    "清除背景"
                  )
                ),
                React.createElement(
                  "p",
                  { className: "dsh-bg-hint" },
                  "「铺满」把整张图片缩放到刚好铺满界面，图片完整可见；「完整」保持原比例显示整张图、留白用同图模糊填充；「裁剪」铺满界面并裁掉超出部分。壁纸与视频都会自动保存，重启应用后仍然保留。"
                ),
                React.createElement("input", {
                  ref: imageInput,
                  type: "file",
                  accept: "image/*",
                  style: { display: "none" },
                  onChange: onPickImage
                }),
                React.createElement("input", {
                  ref: videoInput,
                  type: "file",
                  accept: "video/*",
                  style: { display: "none" },
                  onChange: onPickVideo
                })
              )
            : null,
          React.createElement(
            "button",
            {
              type: "button",
              className: "dsh-bg-fab-button",
              title: "背景壁纸",
              "aria-label": "背景壁纸",
              "aria-expanded": open,
              onClick: function () { setOpen(function (o) { return !o; }); }
            },
            icon
          )
        );
      }

      ctx.slots.inject("shell.overlay", function () {
        return ctx.slots.register(
          {
            name: "shell.overlay",
            id: "background-wallpaper-control",
            order: 500,
            label: "背景壁纸"
          },
          BackgroundControl
        );
      });
    }

    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});
