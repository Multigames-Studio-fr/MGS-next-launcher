(function(){
    var main = document.getElementById('main');
    var overlay = document.getElementById('introOverlay');
    var video = document.getElementById('introVideo');
    var skipBtn = document.getElementById('skipIntroBtn');
    // Optional audio element (place an <audio id="introAudio"> in the DOM or add one dynamically)
    var audio = document.getElementById('introAudio') || null;
    // Default volume (0.0 - 1.0). User requested 15%.
    var defaultVolume = 0.10;

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
        // Ensure visible and on top of the overlay/video
        try{ skipBtn.style.display = 'block'; skipBtn.style.zIndex = '50'; skipBtn.style.pointerEvents = 'auto'; }catch(e){}
        skipBtn.addEventListener('click', function(e){ e.preventDefault(); showMain(); });
        document.addEventListener('keydown', function(ev){ if(ev.key === 'Escape' || ev.key === 'Esc') showMain(); });
    }

    function showInteractiveStart(){
        if(!overlay) return;
        var btn = document.getElementById('introStartBtn');
        if(btn) return btn;
        var b = document.createElement('button');
        b.id = 'introStartBtn';
        b.textContent = 'Click to start intro (with sound)';
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
            try{
                // Some browsers require a user gesture to enable audio. Unmute before play as part of the gesture.
                try{ video.muted = false; }catch(e){}
                try{ if(video) video.volume = defaultVolume; }catch(e){}
                // If an audio element exists, try to unmute/play it as part of the same user gesture
                try{
                    if(!audio) audio = document.getElementById('introAudio');
                    if(audio){ audio.muted = false; try{ audio.volume = defaultVolume; }catch(e){}; var pa = audio.play(); if(pa && typeof pa.then === 'function') pa.catch(function(){}); }
                }catch(e){}
                var p = video.play();
                if(p && typeof p.then === 'function') p.catch(function(){ /* ignore */ });
            }catch(e){ /* ignore */ }
        });
        return b;
    }

    function showUnmuteButton(){
        if(!overlay || !video) return;
        var u = document.getElementById('introUnmuteBtn');
        if(u) return u;
        var btn = document.createElement('button');
        btn.id = 'introUnmuteBtn';
        btn.textContent = 'Unmute';
        btn.setAttribute('aria-label','Unmute video');
        btn.title = 'Unmute';
        btn.style.position = 'absolute';
        btn.style.left = 'calc(50% + 120px)';
        btn.style.top = '60%';
        btn.style.transform = 'translate(-50%, -50%)';
        btn.style.padding = '8px 12px';
        btn.style.background = '#1f2937';
        btn.style.color = '#fff';
        btn.style.border = 'none';
        btn.style.borderRadius = '6px';
        btn.style.cursor = 'pointer';
        overlay.appendChild(btn);
        btn.addEventListener('click', function(){
            try{ video.muted = false; try{ if(video) video.volume = defaultVolume; }catch(e){} }catch(e){}
            try{ if(!audio) audio = document.getElementById('introAudio'); if(audio){ audio.muted = false; try{ audio.volume = defaultVolume; }catch(e){}; audio.play().catch(function(){}); } }catch(e){}
            try{ btn.style.display = 'none'; }catch(e){}
        });
        return btn;
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

        var started = false;
        var timeoutId = setTimeout(function(){ if(!started){ showInteractiveStart(); } }, 6000);

        // Allow overlay clicks to act as user gesture for audio
        try{
            overlay.addEventListener('click', function onOverlayClick(e){
                try{ if(e && e.target && e.target.id === 'skipIntroBtn') return; }catch(ex){}
                if(started) return;
                try{ video.muted = false; try{ if(video) video.volume = defaultVolume; }catch(e){} }catch(e){}
                try{ if(!audio) audio = document.getElementById('introAudio'); if(audio){ audio.muted = false; try{ audio.volume = defaultVolume; }catch(e){}; audio.play().catch(function(){}); } }catch(e){}
                try{ var p = video.play(); if(p && typeof p.then === 'function') p.catch(function(){}); }catch(e){}
                try{ overlay.removeEventListener('click', onOverlayClick); }catch(e){}
            });
        }catch(e){}

        // Attach common media events (no verbose logging)
        ['loadstart','loadedmetadata','loadeddata','canplay','canplaythrough','playing','pause','ended','stalled','suspend','error'].forEach(function(evt){
            video.addEventListener(evt, function(){ /* noop */ });
        });

        video.addEventListener('playing', function(){
            // Mark started and clear timeout. Do NOT hide the skip button so it remains available during playback.
            started = true;
            if(timeoutId) clearTimeout(timeoutId);
            // ensure the skip button stays on top (in case styles change)
            try{ if(skipBtn){ skipBtn.style.display = 'block'; skipBtn.style.zIndex = '50'; } }catch(e){}
        });
        video.addEventListener('ended', function(){ if(timeoutId) clearTimeout(timeoutId); try{ fadeOutOverlay(700).then(showMain); }catch(e){ showMain(); } });
        video.addEventListener('error', function(){ if(timeoutId) clearTimeout(timeoutId); showInteractiveStart(); });

        // Start playback (best-effort). Try to set volume to default before play.
        try{
            try{ if(video) video.volume = defaultVolume; }catch(e){}
            if(audio){ try{ audio.volume = defaultVolume }catch(e){} }
            var p = video.play();
            if(p && typeof p.then === 'function'){
                p.then(function(){}).catch(function(){ showInteractiveStart(); });
            }
        }catch(e){ showInteractiveStart(); }
    })();

})();