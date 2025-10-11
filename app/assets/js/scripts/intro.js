(function(){
    var main = document.getElementById('main');
    var overlay = document.getElementById('introOverlay');
    var video = document.getElementById('introVideo');
    var skipBtn = document.getElementById('skipIntroBtn');

    function showMain(){
        try{ if(overlay) overlay.style.display = 'none'; }catch(e){}
        try{ if(main) main.style.display = 'block'; }catch(e){}
        try{ if(video){ video.pause(); video.currentTime = 0; } }catch(e){}
    }

    function fadeOutOverlay(duration){
        return new Promise(function(resolve){
            if(!overlay) return resolve();
            var start = null;
            var initial = parseFloat(window.getComputedStyle(overlay).opacity) || 1;
            function step(ts){
                if(!start) start = ts;
                var elapsed = ts - start;
                var t = Math.min(1, elapsed / duration);
                overlay.style.opacity = (1 - t) * initial + '';
                if(t < 1){ requestAnimationFrame(step); }
                else { resolve(); }
            }
            requestAnimationFrame(step);
        });
    }

    function attachSkip(){
        if(!skipBtn) return;
        skipBtn.addEventListener('click', function(e){ e.preventDefault(); showMain(); });
        document.addEventListener('keydown', function(ev){ if(ev.key === 'Escape' || ev.key === 'Esc') showMain(); });
    }

    function showInteractiveStart(){
        if(!overlay) return;
        var btn = document.getElementById('introStartBtn');
        if(btn) return btn;
        var b = document.createElement('button');
        b.id = 'introStartBtn';
        b.textContent = 'Click to start intro';
        b.style.position = 'absolute';
        b.style.left = '50%';
        b.style.top = '60%';
        b.style.transform = 'translate(-50%, -50%)';
        b.style.padding = '10px 14px';
        b.style.background = '#2d3748';
        b.style.color = '#fff';
        b.style.border = 'none';
        b.style.borderRadius = '6px';
        b.style.cursor = 'pointer';
        overlay.appendChild(b);
        b.addEventListener('click', function(){
            try{ var p = video.play(); if(p && typeof p.then === 'function') p.catch(function(){ /* ignore */ }); }catch(e){ /* ignore */ }
        });
        return b;
    }

    // Main flow
    (function(){
        if(!video || !overlay){ // nothing to do
            if(main) main.style.display = 'block';
            return;
        }

        // Make sure main is hidden while intro plays
        if(main) main.style.display = 'none';

        attachSkip();

        // Allow autoplay by muting; still let user unmute later if needed
        try{ video.muted = true; }catch(e){}

        var started = false;
        var timeoutId = setTimeout(function(){ if(!started){ showInteractiveStart(); } }, 6000);

        // Attach common media events (no verbose logging)
        ['loadstart','loadedmetadata','loadeddata','canplay','canplaythrough','playing','pause','ended','stalled','suspend','error'].forEach(function(evt){
            video.addEventListener(evt, function(){ /* noop */ });
        });

        video.addEventListener('playing', function(){ started = true; if(timeoutId) clearTimeout(timeoutId); if(skipBtn) skipBtn.style.display = 'none'; });
        video.addEventListener('ended', function(){ if(timeoutId) clearTimeout(timeoutId); try{ fadeOutOverlay(700).then(showMain); }catch(e){ showMain(); } });
        video.addEventListener('error', function(){ if(timeoutId) clearTimeout(timeoutId); showInteractiveStart(); });

        // Start playback (best-effort)
        try{
            var p = video.play();
            if(p && typeof p.then === 'function'){
                p.then(function(){}).catch(function(){ showInteractiveStart(); });
            }
        }catch(e){ showInteractiveStart(); }
    })();
})();