// Inline landing scripts extracted from `app/landing.ejs` to satisfy CSP (load as external script)

// Minimal DOM ready hook placeholder
window.addEventListener('DOMContentLoaded', () => {});

// Hook bouton refresh news
document.addEventListener('DOMContentLoaded', () => {
    const btn = document.querySelector('.refresh-news');
    if (btn && typeof initNews === 'function') {
        btn.addEventListener('click', () => {
            btn.disabled = true;
            btn.classList.add('opacity-60');
            initNews().finally(() => {
                btn.disabled = false;
                btn.classList.remove('opacity-60');
            });
        });
    }
});

// Safely set sidebar username when AuthManager is available.
(function () {
    function setSidebarUsername() {
        try {
            const usernameEl = document.getElementById('sidebar-username');
            const usernameSidebarEl = document.getElementById('username'); // legacy / alternative id used in landing.ejs
            const avatarContainer = document.getElementById('avatarContainer');
            const acc = (window.AuthManager && typeof window.AuthManager.getCurrentAccount === 'function') ? window.AuthManager.getCurrentAccount() : null;
            // Determine display name from account or existing placeholders
            // Prefer displayName when available (friendly name), fallback to username (may be email)
            const displayName = (acc && (acc.displayName || acc.username)) ? (acc.displayName || acc.username) : (usernameEl && usernameEl.textContent) || (usernameSidebarEl && usernameSidebarEl.textContent) || 'Pseudo';
            if (usernameEl) {
                usernameEl.textContent = displayName;
            }
            if (usernameSidebarEl) {
                usernameSidebarEl.textContent = displayName;
            }
            // If we have an avatar url or uuid, set it as the background of avatarContainer
            if (avatarContainer && acc) {
                if (acc.avatarUrl) {
                    avatarContainer.style.backgroundImage = `url('${acc.avatarUrl}')`;
                    avatarContainer.style.backgroundSize = 'cover';
                    avatarContainer.style.backgroundPosition = 'center';
                } else if (acc.uuid) {
                    // Use mc-heads service to fetch a small avatar
                    avatarContainer.style.backgroundImage = `url('https://mc-heads.net/avatar/${acc.uuid}/40')`;
                    avatarContainer.style.backgroundSize = 'cover';
                    avatarContainer.style.backgroundPosition = 'center';
                }
            }
        } catch (e) {
            // Don't break the rest of the scripts if AuthManager isn't present or throws
            console.warn('Failed to set sidebar username/avatar', e);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setSidebarUsername);
    } else {
        setSidebarUsername();
    }
})();

// Progress bar handler compatible avec le code existant
(function () {
    const root = document.querySelector('.game-launch-overlay');
    if (!root) return;
    const bar = root.querySelector('#launch_progress_bar');
    const valueEl = root.querySelector('#launch_progress_label');
    const labelEl = root.querySelector('#launch_details_text');

    window.gameLaunchUI = {
        show(label = 'Préparation du jeu...') {
            if (labelEl) labelEl.textContent = label;
            root.classList.remove('hidden');
            requestAnimationFrame(() => root.classList.add('active'));
        },
        hide() {
            root.classList.remove('active');
            setTimeout(() => root.classList.add('hidden'), 380);
        },
        progress(pct, label) {
            if (pct < 0) pct = 0;
            if (pct > 100) pct = 100;
            if (bar) bar.style.width = pct + '%';
            if (valueEl) valueEl.textContent = pct.toFixed(0) + '%';
            if (label && labelEl) labelEl.textContent = label;
        },
        reset() {
            this.progress(0, 'Initialisation...');
        }
    };

    // Override des fonctions existantes pour la compatibilité
    window.oldToggleLaunchArea = window.toggleLaunchArea;
    window.toggleLaunchArea = function (loading) {
        if (loading) {
            root.classList.remove('hidden');
            const play = document.querySelector('.play-instance');
            if (play) play.style.display = 'none';
        } else {
            root.classList.add('hidden');
            const play = document.querySelector('.play-instance');
            if (play) play.style.display = 'flex';
        }
    };

    window.oldSetLaunchPercentage = window.setLaunchPercentage;
    window.setLaunchPercentage = function (percent) {
        if (bar) bar.style.width = percent + '%';
        if (valueEl) valueEl.textContent = percent + '%';
        // Garde l'ancienne progress bar cachée mais mise à jour
        const oldProgress = document.getElementById('launch_progress');
        if (oldProgress) {
            oldProgress.setAttribute('value', percent);
        }
    };

    window.oldSetLaunchDetails = window.setLaunchDetails;
    window.setLaunchDetails = function (details) {
        if (labelEl) labelEl.textContent = details;
    };
})();

// Helper: create a news card from data and inject into .news-list
window.renderNewsCard = function (data) {
    const tpl = document.getElementById('news-card-template');
    if (!tpl) return null;
    const el = tpl.content.firstElementChild.cloneNode(true);
    const imgEl = el.querySelector('.news-image');
    const badgesEl = el.querySelector('.news-badges');
    const title = el.querySelector('.news-title-stacked');
    const excerpt = el.querySelector('.news-excerpt-stacked');
    const dateDay = el.querySelector('.news-date-day');
    const dateMonth = el.querySelector('.news-date-month');
    const openBtn = el.querySelector('.news-open-button');
    const playBtn = el.querySelector('.news-play');

    if (data.thumb) imgEl.style.backgroundImage = `url('${data.thumb}')`;
    if (data.title) title.textContent = data.title;
    if (data.excerpt) excerpt.textContent = data.excerpt;
    if (data.link) el.setAttribute('data-link', data.link);

    // badges (array of text or HTML snippets)
    badgesEl.innerHTML = '';
    if (Array.isArray(data.badges)) {
        data.badges.forEach(b => {
            const span = document.createElement('span');
            span.className = 'inline-block px-2 py-1 bg-white/10 text-xs rounded font-semibold';
            span.textContent = b;
            badgesEl.appendChild(span);
        });
    }

    // date support
    if (data.date) {
        if (typeof data.date === 'string') {
            const d = new Date(data.date);
            if (!isNaN(d)) {
                if (dateDay) dateDay.textContent = d.getDate();
                if (dateMonth) dateMonth.textContent = d.toLocaleString('default', { month: 'short' });
            }
        } else if (typeof data.date === 'object') {
            if (dateDay) dateDay.textContent = data.date.day || '';
            if (dateMonth) dateMonth.textContent = data.date.month || '';
        }
    }

    // show play overlay when data.play === true
    if (data.play) {
        playBtn.style.opacity = '1';
        playBtn.style.pointerEvents = 'none';
    }

    if (openBtn) {
        openBtn.addEventListener('click', () => {
            const link = el.getAttribute('data-link');
            if (link) window.open(link, '_blank');
        });
    }

    return el;
};

// Set the latest news content into news grid
window.setLatestNews = function (data) {
    const grid = document.querySelector('.news-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const card = window.renderNewsCard(data);
    if (card) grid.appendChild(card);
};

// Helper: create modpack instance cards
window.createModpackCard = function (instance, isSelected = false) {
    const card = document.createElement('div');
    card.className = `modpack-card rounded-2xl p-4 flex items-center gap-3 cursor-pointer ${isSelected
        ? 'bg-gradient-to-r from-orange-500 to-orange-600'
        : 'bg-gradient-to-r from-gray-700 to-gray-800 opacity-80 hover:opacity-100'
        }`;
    card.setAttribute('data-instance-id', instance.id || instance.rawServerId);

    const avatar = document.createElement('div');
    avatar.className = 'modpack-avatar w-12 h-12 bg-amber-800 rounded-xl flex items-center justify-center';

    const avatarIcon = document.createElement('div');
    avatarIcon.className = 'w-8 h-8 bg-cover bg-center rounded-lg';
    if (instance.icon) {
        avatarIcon.style.backgroundImage = `url('${instance.icon}')`;
    } else {
        avatarIcon.style.backgroundImage = "url('./assets/images/minecraft.ico')";
    }
    avatar.appendChild(avatarIcon);

    const content = document.createElement('div');
    content.className = 'flex-1';

    const badgeContainer = document.createElement('div');
    badgeContainer.className = 'flex items-center gap-2 mb-1';

    // Badge pour le type d'instance
    const badge = document.createElement('span');
    badge.className = 'bg-white/20 text-white text-xs px-2 py-1 rounded-full font-semibold';
    badge.textContent = instance.type || 'MODPACK';
    badgeContainer.appendChild(badge);

    const title = document.createElement('h3');
    title.className = 'text-white font-bold text-lg';
    title.textContent = instance.name || instance.displayName || 'Modpack';

    content.appendChild(badgeContainer);
    content.appendChild(title);

    card.appendChild(avatar);
    card.appendChild(content);

    // Ajouter l'événement de clic
    card.addEventListener('click', () => {
        // Désélectionner toutes les autres cartes
        document.querySelectorAll('.modpack-card').forEach(c => {
            c.className = c.className.replace('selected', '').replace('bg-gradient-to-r from-orange-500 to-orange-600', 'bg-gradient-to-r from-gray-700 to-gray-800 opacity-80 hover:opacity-100');
        });

        // Sélectionner cette carte
        card.className = 'modpack-card rounded-2xl p-4 flex items-center gap-3 cursor-pointer selected bg-gradient-to-r from-orange-500 to-orange-600';

        // Trigger l'événement de sélection d'instance (compatible avec le code existant)
        if (window.setSelectedInstance) {
            window.setSelectedInstance(instance);
        }
    });

    return card;
};

// Fonction pour populer les instances modpack
window.populateModpackInstances = function (instances, selectedInstanceId = null) {
    // Utiliser le nouveau conteneur de cartes
    const container = document.getElementById('sidebar-instances-cards') || document.getElementById('modpack-instances-container');
    if (!container) {
        console.error('Aucun conteneur trouvé pour les cartes modpack');
        return;
    }

    container.innerHTML = '';

    if (!instances || instances.length === 0) {
        const placeholder = document.createElement('div');
        placeholder.className = 'text-white/50 text-sm text-center py-4';
        placeholder.textContent = 'Aucune instance disponible';
        container.appendChild(placeholder);
        return;
    }

    instances.forEach((instance, index) => {
        const isSelected = selectedInstanceId ?
            (instance.id === selectedInstanceId || instance.rawServerId === selectedInstanceId) :
            index === 0; // Première instance sélectionnée par défaut

        const card = window.createModpackCard(instance, isSelected);
        container.appendChild(card);
    });

    console.log(`Populated ${instances.length} modpack cards in`, container.id);
};

// ADDED: small script to trigger animations and stagger children
document.addEventListener('DOMContentLoaded', () => {
    try {
        // Fade main content
        const mainContent = document.querySelector('.max-w-3xl.space-y-6');
        if (mainContent) mainContent.classList.add('animate-fade');

        // Slide-in avatar and username
    const avatar = document.getElementById('avatarContainer');
    // support both the new id (#sidebar-username) and the legacy/alternate id (#username)
    const username = document.getElementById('sidebar-username') || document.getElementById('username');
    if (avatar) avatar.classList.add('animate-slide-right');
    if (username) username.classList.add('animate-slide-right');

        // Stagger existing sidebar items
        const sidebar = document.getElementById('sidebar-instances');
        if (sidebar && sidebar.children.length) {
            Array.from(sidebar.children).forEach((el, i) => {
                el.classList.add('stagger-item');
                setTimeout(() => el.classList.add('in'), i * 80);
            });
        }

        // Observe modpack container to animate cards when injected
        const modpackContainer = document.getElementById('sidebar-instances-cards') || document.getElementById('modpack-instances-container');
        if (modpackContainer) {
            const animateExisting = () => {
                Array.from(modpackContainer.children).forEach((el, i) => {
                    el.style.animationDelay = (i * 70) + 'ms';
                    if (!el.classList.contains('animated-pop')) el.classList.add('animated-pop');
                });
            };
            animateExisting();
            const obs = new MutationObserver((mutations) => {
                animateExisting();
            });
            obs.observe(modpackContainer, { childList: true });
        }

        // Small entrance for news-card if present
        const newsGrid = document.querySelector('.news-grid');
        if (newsGrid) {
            Array.from(newsGrid.children).forEach((el, i) => {
                el.style.animation = `fadeUp 480ms cubic-bezier(.2,.9,.2,1) both`;
                el.style.animationDelay = (i * 80) + 'ms';
            });
        }
    } catch (e) {
        // don't break page
        console.warn('Landing animations init failed', e);
    }
});

// When populateModpackInstances is used elsewhere, ensure cards get the pop animation.
(function () {
    const orig = window.populateModpackInstances;
    if (typeof orig === 'function') {
        window.populateModpackInstances = function (...args) {
            const res = orig.apply(this, args);
            // give a tick for DOM insert then animate
            setTimeout(() => {
                const modpackContainer = document.getElementById('sidebar-instances-cards') || document.getElementById('modpack-instances-container');
                if (modpackContainer) {
                    Array.from(modpackContainer.children).forEach((el, i) => {
                        el.style.animationDelay = (i * 70) + 'ms';
                        if (!el.classList.contains('animated-pop')) el.classList.add('animated-pop');
                    });
                }
            }, 30);
            return res;
        };
    }
})();
