// Requirements
const os = require("os");
const semver = require("semver");

const DropinModUtil = require("./assets/js/dropinmodutil");


// Import IPC constants if not already loaded
if (typeof MSFT_OPCODE === 'undefined') {
  var { MSFT_OPCODE, MSFT_REPLY_TYPE, MSFT_ERROR } = require("./assets/js/ipcconstants");
}

const settingsState = {
  invalid: new Set(),
};

function bindSettingsSelect() {
  for (let ele of document.getElementsByClassName("settingsSelectContainer")) {
    const selectedDiv = ele.getElementsByClassName("settingsSelectSelected")[0];

    selectedDiv.onclick = (e) => {
      e.stopPropagation();
      closeSettingsSelect(e.target);
      e.target.nextElementSibling.toggleAttribute("hidden");
      e.target.classList.toggle("select-arrow-active");
    };
  }
}

function closeSettingsSelect(el) {
  for (let ele of document.getElementsByClassName("settingsSelectContainer")) {
    const selectedDiv = ele.getElementsByClassName("settingsSelectSelected")[0];
    const optionsDiv = ele.getElementsByClassName("settingsSelectOptions")[0];

    if (!(selectedDiv === el)) {
      selectedDiv.classList.remove("select-arrow-active");
      optionsDiv.setAttribute("hidden", "");
    }
  }
}

/* If the user clicks anywhere outside the select box,
then close all select boxes: */
document.addEventListener("click", closeSettingsSelect);

bindSettingsSelect();

function bindFileSelectors() {
  for (let ele of document.getElementsByClassName("settingsFileSelButton")) {
    ele.onclick = async (e) => {
      const isJavaExecSel = ele.id === "settingsJavaExecSel";
      const directoryDialog =
        ele.hasAttribute("dialogDirectory") &&
        ele.getAttribute("dialogDirectory") == "true";
      const properties = directoryDialog
        ? ["openDirectory", "createDirectory"]
        : ["openFile"];

      const options = {
        properties,
      };

      if (ele.hasAttribute("dialogTitle")) {
        options.title = ele.getAttribute("dialogTitle");
      }

      if (isJavaExecSel && process.platform === "win32") {
        options.filters = [
          {
            name: Lang.queryJS("settings.fileSelectors.executables"),
            extensions: ["exe"],
          },
          {
            name: Lang.queryJS("settings.fileSelectors.allFiles"),
            extensions: ["*"],
          },
        ];
      }

      const res = await remote.dialog.showOpenDialog(
        remote.getCurrentWindow(),
        options
      );
      if (!res.canceled) {
        ele.previousElementSibling.value = res.filePaths[0];
        if (isJavaExecSel) {
          await populateJavaExecDetails(ele.previousElementSibling.value);
        }
      }
    };
  }
}

bindFileSelectors();

/**
 * General Settings Functions
 */

/**
 * Bind value validators to the settings UI elements. These will
 * validate against the criteria defined in the ConfigManager (if
 * any). If the value is invalid, the UI will reflect this and saving
 * will be disabled until the value is corrected. This is an automated
 * process. More complex UI may need to be bound separately.
 */
function initSettingsValidators() {
  const sEls = document
    .getElementById("settingsContainer")
    .querySelectorAll("[cValue]");
  Array.from(sEls).map((v, index, arr) => {
    const vFn = ConfigManager["validate" + v.getAttribute("cValue")];
    if (typeof vFn === "function") {
      if (v.tagName === "INPUT") {
        if (v.type === "number" || v.type === "text") {
          v.addEventListener("keyup", (e) => {
            const v = e.target;
            if (!vFn(v.value)) {
              settingsState.invalid.add(v.id);
              v.setAttribute("error", "");
              settingsSaveDisabled(true);
            } else {
              if (v.hasAttribute("error")) {
                v.removeAttribute("error");
                settingsState.invalid.delete(v.id);
                if (settingsState.invalid.size === 0) {
                  settingsSaveDisabled(false);
                }
              }
            }
          });
        }
      }
    }
  });
}

/**
 * Load configuration values onto the UI. This is an automated process.
 */
async function initSettingsValues() {
  const sEls = document
    .getElementById("settingsContainer")
    .querySelectorAll("[cValue]");

  for (const v of sEls) {
    const cVal = v.getAttribute("cValue");
    const serverDependent = v.hasAttribute("serverDependent"); // Means the first argument is the server id.
    const gFn = ConfigManager["get" + cVal];
    const gFnOpts = [];
    if (serverDependent) {
      gFnOpts.push(ConfigManager.getSelectedServer());
    }
    if (typeof gFn === "function") {
      if (v.tagName === "INPUT") {
        if (v.type === "number" || v.type === "text" || v.type === "range") {
          // Special Conditions
          if (cVal === "JavaExecutable") {
            v.value = gFn.apply(null, gFnOpts);
            await populateJavaExecDetails(v.value);
          } else if (cVal === "DataDirectory") {
            v.value = gFn.apply(null, gFnOpts);
          } else if (cVal === "JVMOptions") {
            v.value = gFn.apply(null, gFnOpts).join(" ");
          } else {
            // For numeric/range inputs the config may return strings like "3G" or "1536M".
            let val = gFn.apply(null, gFnOpts);
            if ((cVal === "MinRAM" || cVal === "MaxRAM") && typeof val === "string") {
              if (val.endsWith("M")) {
                val = Number(val.substring(0, val.length - 1)) / 1024;
              } else if (val.endsWith("G")) {
                val = Number(val.substring(0, val.length - 1));
              } else {
                val = Number.parseFloat(val);
              }
            }
            v.value = val;
          }
        } else if (v.type === "checkbox") {
          v.checked = gFn.apply(null, gFnOpts);
        }
      } else if (v.tagName === "DIV") {
        if (v.classList.contains("rangeSlider")) {
          // Special Conditions
          if (cVal === "MinRAM" || cVal === "MaxRAM") {
            let val = gFn.apply(null, gFnOpts);
            if (val.endsWith("M")) {
              val = Number(val.substring(0, val.length - 1)) / 1024;
            } else {
              val = Number.parseFloat(val);
            }

            v.setAttribute("value", val);
          } else {
            v.setAttribute(
              "value",
              Number.parseFloat(gFn.apply(null, gFnOpts))
            );
          }
        }
      }
    }
  }
}

/**
 * Save the settings values.
 */
function saveSettingsValues() {
  const sEls = document
    .getElementById("settingsContainer")
    .querySelectorAll("[cValue]");
  Array.from(sEls).map((v, index, arr) => {
    const cVal = v.getAttribute("cValue");
    const serverDependent = v.hasAttribute("serverDependent"); // Means the first argument is the server id.
    const sFn = ConfigManager["set" + cVal];
    const sFnOpts = [];
    if (serverDependent) {
      sFnOpts.push(ConfigManager.getSelectedServer());
    }
    if (typeof sFn === "function") {
      if (v.tagName === "INPUT") {
        if (v.type === "number" || v.type === "text" || v.type === "range") {
          // Special Conditions
          if (cVal === "JVMOptions") {
            if (!v.value.trim()) {
              sFnOpts.push([]);
              sFn.apply(null, sFnOpts);
            } else {
              sFnOpts.push(v.value.trim().split(/\s+/));
              sFn.apply(null, sFnOpts);
            }
          } else if (v.type === "range") {
            // Range inputs store numeric GB values; convert to expected storage format
            if (cVal === "MinRAM" || cVal === "MaxRAM") {
              let val = Number(v.value);
              if (val % 1 > 0) {
                val = Math.round(val * 1024) + "M";
              } else {
                val = val + "G";
              }
              sFnOpts.push(val);
            } else {
              sFnOpts.push(v.value);
            }
            sFn.apply(null, sFnOpts);
          } else {
            sFnOpts.push(v.value);
            sFn.apply(null, sFnOpts);
          }
        } else if (v.type === "checkbox") {
          sFnOpts.push(v.checked);
          sFn.apply(null, sFnOpts);
          // Special Conditions
          if (cVal === "AllowPrerelease") {
            changeAllowPrerelease(v.checked);
          }
        }
      } else if (v.tagName === "DIV") {
        if (v.classList.contains("rangeSlider")) {
          // Special Conditions
          if (cVal === "MinRAM" || cVal === "MaxRAM") {
            let val = Number(v.getAttribute("value"));
            if (val % 1 > 0) {
              // Avoid floating point precision errors when converting
              // fractional gigabyte values (e.g., 31.5G) into megabytes.
              // Round to nearest integer megabyte.
              val = Math.round(val * 1024) + "M";
            } else {
              val = val + "G";
            }

            sFnOpts.push(val);
            sFn.apply(null, sFnOpts);
          } else {
            sFnOpts.push(v.getAttribute("value"));
            sFn.apply(null, sFnOpts);
          }
        }
      }
    }
  });
}

let selectedSettingsTab = "settingsTabAccount";

/**
 * Modify the settings container UI when the scroll threshold reaches
 * a certain poin.
 *
 * @param {UIEvent} e The scroll event.
 */
function settingsTabScrollListener(e) {
  if (
    e.target.scrollTop >
    Number.parseFloat(getComputedStyle(e.target.firstElementChild).marginTop)
  ) {
    document.getElementById("settingsContainer").setAttribute("scrolled", "");
  } else {
    document.getElementById("settingsContainer").removeAttribute("scrolled");
  }
}

/**
 * Bind functionality for the settings navigation items.
 */
function setupSettingsTabs() {
  Array.from(document.getElementsByClassName("settingsNavItem")).map((val) => {
    if (val.hasAttribute("rSc")) {
      val.onclick = () => {
        settingsNavItemListener(val);
      };
    }
  });
}

/**
 * Settings nav item onclick lisener. Function is exposed so that
 * other UI elements can quickly toggle to a certain tab from other views.

  // Dispatch a tab activation event for other scripts to react to (e.g., request log history)
  try {
    const ev = new CustomEvent('settings-tab-activated', { detail: { tabId: selectedSettingsTab } });
    window.dispatchEvent(ev);
  } catch (e) {
    // ignore if CustomEvent unsupported
  }
 *
 * @param {Element} ele The nav item which has been clicked.
 * @param {boolean} fade Optional. True to fade transition.
 */
function settingsNavItemListener(ele, fade = false) {
  if (ele.hasAttribute("selected")) {
    return;
  }
  const navItems = document.getElementsByClassName("settingsNavItem");
  for (let i = 0; i < navItems.length; i++) {
    if (navItems[i].hasAttribute("selected")) {
      navItems[i].removeAttribute("selected");
    }
  }
  ele.setAttribute("selected", "");
  let prevTab = selectedSettingsTab;
  selectedSettingsTab = ele.getAttribute("rSc");

  document.getElementById(prevTab).onscroll = null;
  document.getElementById(selectedSettingsTab).onscroll =
    settingsTabScrollListener;

  if (fade) {
    $(`#${prevTab}`).fadeOut(250, () => {
      $(`#${selectedSettingsTab}`).fadeIn({
        duration: 250,
        start: () => {
          settingsTabScrollListener({
            target: document.getElementById(selectedSettingsTab),
          });
        },
        complete: () => {
          try {
            const ev = new CustomEvent('settings-tab-activated', { detail: { tabId: selectedSettingsTab } });
            window.dispatchEvent(ev);
          } catch (e) { /* ignore if CustomEvent unsupported */ }
        }
      });
    });
  } else {
    $(`#${prevTab}`).hide(0, () => {
      $(`#${selectedSettingsTab}`).show({
        duration: 0,
        start: () => {
          settingsTabScrollListener({
            target: document.getElementById(selectedSettingsTab),
          });
        },
        complete: () => {
          try {
            const ev = new CustomEvent('settings-tab-activated', { detail: { tabId: selectedSettingsTab } });
            window.dispatchEvent(ev);
          } catch (e) { /* ignore if CustomEvent unsupported */ }
        }
      });
    });
  }
}

const settingsNavDone = document.getElementById("settingsNavDone");

/**
 * Set if the settings save (done) button is disabled.
 *
 * @param {boolean} v True to disable, false to enable.
 */
function settingsSaveDisabled(v) {
  if (settingsNavDone) settingsNavDone.disabled = v;
}

function fullSettingsSave() {
  saveSettingsValues();
  saveModConfiguration();
  ConfigManager.save();
  saveDropinModConfiguration();
  saveShaderpackSettings();
}

/* Closes the settings view and saves all data. */
if (settingsNavDone) {
  settingsNavDone.onclick = () => {
    fullSettingsSave();
    switchView(getCurrentView(), VIEWS.landing);
  };
}

/**
 * Account Management Tab
 */

const msftLoginLogger = LoggerUtil.getLogger("Microsoft Login");
const msftLogoutLogger = LoggerUtil.getLogger("Microsoft Logout");

// Bind the add microsoft account button (defensive: element may be missing)
const _msAddBtn = document.getElementById("settingsAddMicrosoftAccount");
if (_msAddBtn) {
  _msAddBtn.onclick = (e) => {
    switchView(getCurrentView(), VIEWS.waiting, 500, 500, () => {
      ipcRenderer.send(MSFT_OPCODE.OPEN_LOGIN, VIEWS.settings, VIEWS.settings);
    });
  };
}

// Bind reply for Microsoft Login.
ipcRenderer.on(MSFT_OPCODE.REPLY_LOGIN, (_, ...arguments_) => {
  if (arguments_[0] === MSFT_REPLY_TYPE.ERROR) {
    const viewOnClose = arguments_[2];
    console.log(arguments_);
    switchView(getCurrentView(), viewOnClose, 500, 500, () => {
      if (arguments_[1] === MSFT_ERROR.NOT_FINISHED) {
        // User cancelled.
        msftLoginLogger.info("Login cancelled by user.");
        return;
      }

      // Unexpected error.
      setOverlayContent(
        Lang.queryJS("settings.msftLogin.errorTitle"),
        Lang.queryJS("settings.msftLogin.errorMessage"),
        Lang.queryJS("settings.msftLogin.okButton")
      );
      setOverlayHandler(() => {
        toggleOverlay(false);
      });
      toggleOverlay(true);
    });
  } else if (arguments_[0] === MSFT_REPLY_TYPE.SUCCESS) {
    const queryMap = arguments_[1];
    const viewOnClose = arguments_[2];

    // Error from request to Microsoft.
    if (Object.prototype.hasOwnProperty.call(queryMap, "error")) {
      switchView(getCurrentView(), viewOnClose, 500, 500, () => {
        // TODO Dont know what these errors are. Just show them I guess.
        // This is probably if you messed up the app registration with Azure.
        let error = queryMap.error; // Error might be 'access_denied' ?
        let errorDesc = queryMap.error_description;
        console.log(
          "Error getting authCode, is Azure application registered correctly?"
        );
        console.log(error);
        console.log(errorDesc);
        console.log("Full query map: ", queryMap);
        setOverlayContent(
          error,
          errorDesc,
          Lang.queryJS("settings.msftLogin.okButton")
        );
        setOverlayHandler(() => {
          toggleOverlay(false);
        });
        toggleOverlay(true);
      });
    } else {
      msftLoginLogger.info(
        "Acquired authCode, proceeding with authentication."
      );

      const authCode = queryMap.code;
      AuthManager.addMicrosoftAccount(authCode)
        .then((value) => {
          updateSelectedAccount(value);
          switchView(getCurrentView(), viewOnClose, 500, 500, async () => {
            await prepareSettings();
          });
        })
        .catch((displayableError) => {
          let actualDisplayableError;
          if (isDisplayableError(displayableError)) {
            msftLoginLogger.error("Error while logging in.", displayableError);
            actualDisplayableError = displayableError;
          } else {
            // Uh oh.
            msftLoginLogger.error(
              "Unhandled error during login.",
              displayableError
            );
            actualDisplayableError = Lang.queryJS("login.error.unknown");
          }

          switchView(getCurrentView(), viewOnClose, 500, 500, () => {
            setOverlayContent(
              actualDisplayableError.title,
              actualDisplayableError.desc,
              Lang.queryJS("login.tryAgain")
            );
            setOverlayHandler(() => {
              toggleOverlay(false);
            });
            toggleOverlay(true);
          });
        });
    }
  }
});

/**
 * Bind functionality for the account selection buttons. If another account
 * is selected, the UI of the previously selected account will be updated.
 */
function bindAuthAccountSelect() {
  Array.from(document.getElementsByClassName("settingsAuthAccountSelect")).map(
    (val) => {
      val.onclick = (e) => {
        if (val.hasAttribute("selected")) {
          return;
        }
        const selectBtns = document.getElementsByClassName(
          "settingsAuthAccountSelect"
        );
        for (let i = 0; i < selectBtns.length; i++) {
          if (selectBtns[i].hasAttribute("selected")) {
            selectBtns[i].removeAttribute("selected");
            selectBtns[i].innerHTML = Lang.queryJS(
              "settings.authAccountSelect.selectButton"
            );
          }
        }
        val.setAttribute("selected", "");
        val.innerHTML = Lang.queryJS(
          "settings.authAccountSelect.selectedButton"
        );
        setSelectedAccount(
          val.closest(".settingsAuthAccount").getAttribute("uuid")
        );
      };
    }
  );
}

/**
 * Bind functionality for the log out button. If the logged out account was
 * the selected account, another account will be selected and the UI will
 * be updated accordingly.
 */
function bindAuthAccountLogOut() {
  Array.from(document.getElementsByClassName("settingsAuthAccountLogOut")).map(
    (val) => {
      val.onclick = (e) => {
        let isLastAccount = false;
        if (Object.keys(ConfigManager.getAuthAccounts()).length === 1) {
          isLastAccount = true;
          setOverlayContent(
            Lang.queryJS("settings.authAccountLogout.lastAccountWarningTitle"),
            Lang.queryJS(
              "settings.authAccountLogout.lastAccountWarningMessage"
            ),
            Lang.queryJS("settings.authAccountLogout.confirmButton"),
            Lang.queryJS("settings.authAccountLogout.cancelButton")
          );
          setOverlayHandler(() => {
            processLogOut(val, isLastAccount);
            toggleOverlay(false);
          });
          setDismissHandler(() => {
            toggleOverlay(false);
          });
          toggleOverlay(true, true);
        } else {
          processLogOut(val, isLastAccount);
        }
      };
    }
  );
}

let msAccDomElementCache;
/**
 * Process a log out.
 *
 * @param {Element} val The log out button element.
 * @param {boolean} isLastAccount If this logout is on the last added account.
 */
function processLogOut(val, isLastAccount) {
  const parent = val.closest(".settingsAuthAccount");
  const uuid = parent.getAttribute("uuid");
  const prevSelAcc = ConfigManager.getSelectedAccount();
  const targetAcc = ConfigManager.getAuthAccount(uuid);
  if (targetAcc.type === "microsoft") {
    msAccDomElementCache = parent;
    switchView(getCurrentView(), VIEWS.waiting, 500, 500, () => {
      ipcRenderer.send(MSFT_OPCODE.OPEN_LOGOUT, uuid, isLastAccount);
    });
  }
}

// Bind reply for Microsoft Logout.
ipcRenderer.on(MSFT_OPCODE.REPLY_LOGOUT, (_, ...arguments_) => {
  if (arguments_[0] === MSFT_REPLY_TYPE.ERROR) {
    switchView(getCurrentView(), VIEWS.settings, 500, 500, () => {
      if (arguments_.length > 1 && arguments_[1] === MSFT_ERROR.NOT_FINISHED) {
        // User cancelled.
        msftLogoutLogger.info("Logout cancelled by user.");
        return;
      }

      // Unexpected error.
      setOverlayContent(
        Lang.queryJS("settings.msftLogout.errorTitle"),
        Lang.queryJS("settings.msftLogout.errorMessage"),
        Lang.queryJS("settings.msftLogout.okButton")
      );
      setOverlayHandler(() => {
        toggleOverlay(false);
      });
      toggleOverlay(true);
    });
  } else if (arguments_[0] === MSFT_REPLY_TYPE.SUCCESS) {
    const uuid = arguments_[1];
    const isLastAccount = arguments_[2];
    const prevSelAcc = ConfigManager.getSelectedAccount();

    msftLogoutLogger.info("Logout Successful. uuid:", uuid);

    AuthManager.removeMicrosoftAccount(uuid)
      .then(() => {
        if (!isLastAccount && uuid === prevSelAcc.uuid) {
          const selAcc = ConfigManager.getSelectedAccount();
          refreshAuthAccountSelected(selAcc.uuid);
          updateSelectedAccount(selAcc);
          validateSelectedAccount();
        }
        if (isLastAccount) {
          loginOptionsCancelEnabled(false);
          loginOptionsViewOnLoginSuccess = VIEWS.settings;
          loginOptionsViewOnLoginCancel = VIEWS.loginOptions;
          switchView(getCurrentView(), VIEWS.loginOptions);
        }
        if (msAccDomElementCache) {
          msAccDomElementCache.remove();
          msAccDomElementCache = null;
        }
      })
      .finally(() => {
        if (!isLastAccount) {
          switchView(getCurrentView(), VIEWS.settings, 500, 500);
        }
      });
  }
});


/**
 * Refreshes the status of the selected account on the auth account
 * elements.
 *
 * @param {string} uuid The UUID of the new selected account.
 */
function refreshAuthAccountSelected(uuid) {
  Array.from(document.getElementsByClassName("settingsAuthAccount")).map(
    (val) => {
      const selBtn = val.getElementsByClassName("settingsAuthAccountSelect")[0];
      if (uuid === val.getAttribute("uuid")) {
        selBtn.setAttribute("selected", "");
        selBtn.innerHTML = Lang.queryJS(
          "settings.authAccountSelect.selectedButton"
        );
      } else {
        if (selBtn.hasAttribute("selected")) {
          selBtn.removeAttribute("selected");
        }
        selBtn.innerHTML = Lang.queryJS(
          "settings.authAccountSelect.selectButton"
        );
      }
    }
  );
}

// Access the accounts container at call-time to avoid TDZ/circular-require
function getSettingsCurrentMicrosoftAccounts() {
  return document.getElementById("settingsCurrentMicrosoftAccounts");
}

/**
 * Add auth account elements for each one stored in the authentication database.
 */
function populateAuthAccounts() {
  const authAccounts = ConfigManager.getAuthAccounts();
  const authKeys = Object.keys(authAccounts);
  if (authKeys.length === 0) {
    return;
  }
  const selectedUUID = ConfigManager.getSelectedAccount().uuid;

  let microsoftAuthAccountStr = "";

  authKeys.forEach((val) => {
    const acc = authAccounts[val];

    const accHtml = `<div class="settingsAuthAccount group flex items-center p-4 rounded-lg mb-4" uuid="${acc.uuid}">
      <div class="settingsAuthAccountLeft mr-4 flex-shrink-0">
        <div class="settingsAuthAvatar h-25 rounded-md overflow-hidden  flex items-center justify-center">
          <img
            class="settingsAuthAccountImage w-full h-full object-cover"
            alt="${acc.displayName}"
            src="https://crafatar.com/renders/body/${acc.uuid}?size=160&overlay=true"
            onerror="this.onerror=null;this.src='https://mc-heads.net/avatar/${acc.uuid}/60';"
          />
        </div>
      </div>
      <div class="settingsAuthAccountBody flex-grow">
        <div class="flex items-start justify-between">
          <div class="settingsAuthAccountInfo min-w-0">
            <div class="settingsAuthAccountName text-sm text-gray-400 truncate">${Lang.queryJS("settings.authAccountPopulate.username")}</div>
            <div class="settingsAuthAccountDisplay text-lg font-bold text-white truncate">${acc.displayName}</div>
            <div class="settingsAuthAccountUuid mt-1 text-xs text-gray-400 truncate">${Lang.queryJS("settings.authAccountPopulate.uuid")}: <span class="text-white font-mono">${acc.uuid}</span></div>
            <div class="settingsAuthAccountType mt-1 text-xs text-gray-400 truncate">${Lang.queryJS("settings.authAccountPopulate.type")}: <span class="text-white">${acc.type}</span></div>
            <div class="settingsAuthAccountExpiry mt-1 text-xs text-gray-400 truncate">${Lang.queryJS("settings.authAccountPopulate.expires")}: <span class="text-white font-mono">${acc.expiresAt ? new Date(acc.expiresAt).toLocaleString() : Lang.queryJS("settings.authAccountPopulate.noExpiry")}</span></div>
            <div class="settingsAuthAccountTokenStatus mt-1 text-xs text-gray-400 truncate"><span id="tokenStatus-${acc.uuid}">${Date.now() < (acc.expiresAt || 0) ? Lang.queryJS("settings.authAccountPopulate.tokenValid") : Lang.queryJS("settings.authAccountPopulate.tokenInvalid")}</span></div>
          </div>
          <div class="settingsAuthAccountActions flex items-start justify-start ml-4">
            <div class="relative">
              <button type="button" aria-haspopup="true" aria-expanded="false" class="settingsAuthAccountMenuBtn bg-transparent text-gray-300 hover:text-white p-2 rounded focus:outline-none" tabindex="0">&#x2630;</button>
              <div class="settingsAuthAccountMenu hidden absolute right-0 mt-2 w-44 bg-gray-800 border border-gray-700 rounded shadow-lg z-50">
                <button class="w-full text-left settingsAuthAccountSelect px-4 py-2 text-sm text-white hover:bg-gray-700">${selectedUUID === acc.uuid ? Lang.queryJS("settings.authAccountPopulate.selectedAccount") : Lang.queryJS("settings.authAccountPopulate.selectAccount")}</button>
                <button class="w-full text-left settingsAuthAccountRefresh px-4 py-2 text-sm text-white hover:bg-gray-700" refresh-uuid="${acc.uuid}">${Lang.queryJS("settings.authAccountPopulate.checkToken")}</button>
                <button class="w-full text-left settingsAuthAccountLogOut px-4 py-2 text-sm text-red-400 hover:bg-gray-700">${Lang.queryJS("settings.authAccountPopulate.logout")}</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;

    if (acc.type === "microsoft") {
      microsoftAuthAccountStr += accHtml;
    }
  });

  const _container = getSettingsCurrentMicrosoftAccounts();
  if (_container) {
    _container.innerHTML = microsoftAuthAccountStr;
    // Bind refresh (check token) buttons after inserting HTML
    bindAuthAccountRefresh();
    bindAuthAccountMenu();
  }
}

/**
 * Bind functionality for the check/refresh token button for each account.
 */
function bindAuthAccountRefresh() {
  const _container = getSettingsCurrentMicrosoftAccounts();
  if (!_container) return;
  const sEls = _container.querySelectorAll("[refresh-uuid]");
  Array.from(sEls).map((v) => {
    v.onclick = async (e) => {
      const uuid = v.getAttribute("refresh-uuid");
      const origText = v.innerHTML;
      try {
        // Mark button busy
        v.disabled = true;
        v.innerHTML = Lang.queryJS("settings.authAccountPopulate.checking");

        // Set selected account so AuthManager.validateSelected operates on it
        ConfigManager.setSelectedAccount(uuid);

        const valid = await AuthManager.validateSelected();
        const statusEl = document.getElementById(`tokenStatus-${uuid}`);
        if (valid) {
          if (statusEl) statusEl.innerHTML = Lang.queryJS("settings.authAccountPopulate.tokenValid");
        } else {
          if (statusEl) statusEl.innerHTML = Lang.queryJS("settings.authAccountPopulate.tokenInvalid");

          // Offer re-login via login options
          setOverlayContent(
            Lang.queryJS("settings.authAccountPopulate.tokenInvalidTitle"),
            Lang.queryJS("settings.authAccountPopulate.tokenInvalidMessage"),
            Lang.queryJS("settings.authAccountPopulate.reloginButton"),
            Lang.queryJS("settings.authAccountPopulate.cancelButton")
          );
          setOverlayHandler(() => {
            loginOptionsViewOnLoginSuccess = VIEWS.settings;
            loginOptionsViewOnLoginCancel = VIEWS.loginOptions;
            switchView(getCurrentView(), VIEWS.loginOptions);
            toggleOverlay(false);
          });
          setDismissHandler(() => {
            toggleOverlay(false);
          });
          toggleOverlay(true, true);
        }
      } catch (err) {
        setOverlayContent(
          Lang.queryJS("settings.authAccountPopulate.checkFailedTitle"),
          err && err.message ? err.message : String(err),
          Lang.queryJS("settings.authAccountPopulate.okButton")
        );
        setOverlayHandler(() => { toggleOverlay(false); });
        toggleOverlay(true);
      } finally {
        v.disabled = false;
        v.innerHTML = origText;
      }
    };
  });
}

/**
 * Bind menu toggle handlers and close-on-outside-click for account burger menus.
 */
function bindAuthAccountMenu() {
  if (bindAuthAccountMenu._bound) return;
  bindAuthAccountMenu._bound = true;

  // Use event delegation on the accounts container for robustness.
  const _container = getSettingsCurrentMicrosoftAccounts();
  if (!_container) return;
  _container.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('.settingsAuthAccountMenuBtn');
    if (!btn) return;
    e.stopPropagation();

    // Close all menus first
    const menus = _container.querySelectorAll('.settingsAuthAccountMenu');
    Array.from(menus).forEach((m) => m.classList.add('hidden'));

    // Reset aria-expanded for all menu buttons
    const allBtns = _container.querySelectorAll('.settingsAuthAccountMenuBtn');
    Array.from(allBtns).forEach((b) => b.setAttribute('aria-expanded', 'false'));

    // Toggle this menu
    const menu = btn.parentElement && btn.parentElement.querySelector('.settingsAuthAccountMenu') || btn.nextElementSibling;
    if (menu) {
      menu.classList.toggle('hidden');
      const expanded = menu.classList.contains('hidden') ? 'false' : 'true';
      btn.setAttribute('aria-expanded', expanded);
    }
  });

  // Close any open menu when clicking elsewhere in the document
  document.addEventListener('click', () => {
    const _c = getSettingsCurrentMicrosoftAccounts();
    if (!_c) return;
    const menus = _c.querySelectorAll('.settingsAuthAccountMenu');
    Array.from(menus).forEach((m) => m.classList.add('hidden'));
    const allBtns = _c.querySelectorAll('.settingsAuthAccountMenuBtn');
    Array.from(allBtns).forEach((b) => b.setAttribute('aria-expanded', 'false'));
  });
}

/**
 * Prepare the accounts tab for display.
 */
function prepareAccountsTab() {
  populateAuthAccounts();
  bindAuthAccountSelect();
  bindAuthAccountLogOut();
}

/**
 * Minecraft Tab
 */

/**
 * Disable decimals, negative signs, and scientific notation.
 */
(() => {
  const gw = document.getElementById("settingsGameWidth");
  if (gw) {
    gw.addEventListener("keydown", (e) => {
      if (/^[-.eE]$/.test(e.key)) {
        e.preventDefault();
      }
    });
  }
  const gh = document.getElementById("settingsGameHeight");
  if (gh) {
    gh.addEventListener("keydown", (e) => {
      if (/^[-.eE]$/.test(e.key)) {
        e.preventDefault();
      }
    });
  }
})();

/**
 * Mods Tab
 */

const settingsModsContainer = document.getElementById("settingsModsContainer");

// Flag indicating whether drop-in/mod actions are allowed for the
// currently selected server/account. Updated by `resolveDropinModsForUI`.
let DROPIN_WHITELIST_ALLOWED = true;
/**
 * Resolve and update the mods on the UI.
 */
async function resolveModsForUI() {
  const servId = ConfigManager.getSelectedServer();

  const distro = await DistroAPI.getDistribution();
  const serv = distro.getServerById(servId);
  const servConf = ConfigManager.getModConfiguration(servId);

  // Only allow mod controls if the server has an active whitelist.
  // Requirement: If the instance does NOT have a whitelist, disable ability to add/modify custom mods.
  let whitelistAllowed = false;
  try {
    const wl = serv.rawServer.whitelist;
    if (wl && wl.active) {
      whitelistAllowed = true;
    }
  } catch (e) {
    console.warn('[SETTINGS] Error checking whitelist for mods tab', e);
  }

  const modStr = parseModulesForUI(
    serv.modules,
    false,
    servConf.mods,
    whitelistAllowed
  );

  document.getElementById("settingsReqModsContent").innerHTML = modStr.reqMods;
  document.getElementById("settingsOptModsContent").innerHTML = modStr.optMods;
}

/**
 * Recursively build the mod UI elements.
 *
 * @param {Object[]} mdls An array of modules to parse.
 * @param {boolean} submodules Whether or not we are parsing submodules.
 * @param {Object} servConf The server configuration object for this module level.
 */
function parseModulesForUI(mdls, submodules, servConf, whitelistAllowed = true) {
  let reqMods = "";
  let optMods = "";

  for (const mdl of mdls) {
    if (
      mdl.rawModule.type === Type.ForgeMod ||
      mdl.rawModule.type === Type.LiteMod ||
      mdl.rawModule.type === Type.LiteLoader ||
      mdl.rawModule.type === Type.FabricMod
    ) {
      if (mdl.getRequired().value) {
        const subHtml =
          mdl.subModules.length > 0
            ? `<div class="settingsSubModContainer ml-6 mt-2">${Object.values(
                parseModulesForUI(
                  mdl.subModules,
                  true,
                  servConf[mdl.getVersionlessMavenIdentifier()],
                  whitelistAllowed
                )
              ).join("")}</div>`
            : "";

        reqMods += `<div id="${mdl.getVersionlessMavenIdentifier()}" class="settingsBaseMod settingsReqMod ${
          submodules ? "settingsSubMod" : ""
        }" enabled>
          <div class="settingsModContent p-4 bg-gray-800/80 border border-gray-700 rounded-lg shadow-lg mb-3 group hover:bg-gray-800 transition-all">
            <div class="flex items-center gap-3">
              <div class="settingsModStatus w-3 h-3 bg-green-500 rounded-full flex-shrink-0 shadow-lg shadow-green-500/50"></div>
              <div class="settingsModDetails flex-1 min-w-0">
                <div class="text-base font-semibold text-white truncate">${mdl.rawModule.name}</div>
                <div class="text-xs text-gray-400 mt-0.5">v${mdl.mavenComponents.version} • Required</div>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-xs font-medium text-green-400 bg-green-400/10 px-2 py-1 rounded border border-green-400/20">Required</span>
              </div>
            </div>
          </div>
          ${subHtml}
        </div>`;
      } else {
        const conf = servConf[mdl.getVersionlessMavenIdentifier()];
        const val = typeof conf === "object" ? conf.value : conf;
        const subHtml =
          mdl.subModules.length > 0
            ? `<div class="settingsSubModContainer ml-6 mt-2">${Object.values(
                parseModulesForUI(mdl.subModules, true, conf.mods, whitelistAllowed)
              ).join("")}</div>`
            : "";

        // Optional mods should always be toggleable by the user, regardless of whitelist status
        const toggleDisabledAttr = "";
        const containerDisabledClasses = "";

        optMods += `<div id="${mdl.getVersionlessMavenIdentifier()}" class="settingsBaseMod ${
          submodules ? "settingsSubMod" : ""
        } ${containerDisabledClasses}" ${val ? "enabled" : ""}>
          <div class="settingsModContent p-4 bg-gray-800/80 border border-gray-700 rounded-lg shadow-lg mb-3 group hover:bg-gray-800 transition-all">
            <div class="flex items-center justify-between gap-4">
              <div class="flex items-center gap-3 flex-1 min-w-0">
                <div class="settingsModStatus w-3 h-3 ${
                  val ? "bg-green-500 shadow-green-500/50" : "bg-red-500 shadow-red-500/50"
                } rounded-full flex-shrink-0 shadow-lg"></div>
                <div class="settingsModDetails flex-1 min-w-0">
                  <div class="text-base font-semibold text-white truncate">${mdl.rawModule.name}</div>
                  <div class="text-xs text-gray-400 mt-0.5">v${mdl.mavenComponents.version} • ${val ? 'Enabled' : 'Disabled'}</div>
                </div>
              </div>
              <div class="flex-shrink-0">
                <label class="toggleSwitch relative inline-block">
                  <input type="checkbox" formod="${mdl.getVersionlessMavenIdentifier()}" ${
          val ? "checked" : ""
        } ${toggleDisabledAttr} class="sr-only peer">
                  <span class="toggleSwitchSlider block w-11 h-6 bg-gray-600 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-yellow-500/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></span>
                </label>
              </div>
            </div>
          </div>
          ${subHtml}
        </div>`;
      }
    }
  }

  return { reqMods, optMods };
}


/**
 * Bind functionality to mod config toggle switches. Switching the value
 * will also switch the status color on the left of the mod UI.
 */
function bindModsToggleSwitch() {
  const sEls = settingsModsContainer.querySelectorAll("[formod]");
  Array.from(sEls).map((v, index, arr) => {
    v.onchange = () => {
      const modId = v.getAttribute("formod");
      const modElement = document.getElementById(modId);
      
      if (v.checked) {
        if (modElement) modElement.setAttribute("enabled", "");
      } else {
        // Prevent unchecking required mods
        const isRequired = modElement && modElement.classList.contains("settingsReqMod");
        if (isRequired) {
          v.checked = true;
          return;
        }
        if (modElement) modElement.removeAttribute("enabled");
      }
    };
  });
}

/**
 * Ensure all required mods are always enabled and not unchecked by the user.
 */
function ensureRequiredModsEnabled() {
  const reqMods = settingsModsContainer.querySelectorAll(".settingsReqMod [formod]");
  Array.from(reqMods).map((v) => {
    v.checked = true;
    v.disabled = true;
  });
}

/**
 * Save the mod configuration based on the UI values.
 */
function saveModConfiguration() {
  const serv = ConfigManager.getSelectedServer();
  const modConf = ConfigManager.getModConfiguration(serv);
  modConf.mods = _saveModConfiguration(modConf.mods);
  ConfigManager.setModConfiguration(serv, modConf);
}

/**
 * Force download verification and update of mods for the current server.
 * This ensures all selected mods are downloaded with integrity checks.
 */
async function forceModsDownloadCheck() {
  const serv = ConfigManager.getSelectedServer();
  const modConf = ConfigManager.getModConfiguration(serv);
  
  // Mark all enabled mods for re-download verification
  modConf.forceValidation = true;
  ConfigManager.setModConfiguration(serv, modConf);
  ConfigManager.save();
  
  // Show confirmation overlay
  setOverlayContent(
    Lang.queryJS("settings.forceDownload.title") || "Vérification forcée",
    Lang.queryJS("settings.forceDownload.message") || "Les mods seront téléchargés et vérifiés avant le prochain lancement.",
    Lang.queryJS("settings.forceDownload.okButton") || "OK"
  );
  setOverlayHandler(() => {
    toggleOverlay(false);
  });
  toggleOverlay(true);
}

/**
 * Recursively save mod config with submods.
 *
 * @param {Object} modConf Mod config object to save.
 */
function _saveModConfiguration(modConf) {
  for (let m of Object.entries(modConf)) {
    const tSwitch = settingsModsContainer.querySelectorAll(
      `[formod='${m[0]}']`
    );
    if (tSwitch.length > 0 && !tSwitch[0].hasAttribute("dropin")) {
      if (typeof m[1] === "boolean") {
        modConf[m[0]] = tSwitch[0].checked;
      } else {
        if (m[1] != null) {
          modConf[m[0]].value = tSwitch[0].checked;
          modConf[m[0]].mods = _saveModConfiguration(modConf[m[0]].mods);
        }
      }
    }
  }
  return modConf;
}

// Drop-in mod elements.

let CACHE_SETTINGS_MODS_DIR;
let CACHE_DROPIN_MODS;

/**
 * Resolve any located drop-in mods for this server and
 * populate the results onto the UI.
 */
async function resolveDropinModsForUI() {
  const serv = (await DistroAPI.getDistribution()).getServerById(
    ConfigManager.getSelectedServer()
  );
  CACHE_SETTINGS_MODS_DIR = path.join(
    ConfigManager.getInstanceDirectory(),
    serv.rawServer.id,
    "mods"
  );
  CACHE_DROPIN_MODS = DropinModUtil.scanForDropinMods(
    CACHE_SETTINGS_MODS_DIR,
    serv.rawServer.minecraftVersion
  );
  // Only allow drop-in mod controls if the server has an active whitelist.
  let whitelistAllowed = false;
  try {
    const wl = serv.rawServer.whitelist;
    if (wl && wl.active) {
      whitelistAllowed = true;
    }
  } catch (e) {
    console.warn('[SETTINGS] Error checking whitelist for dropin mods', e);
  }

  // Update module-level flag used by bind functions.
  DROPIN_WHITELIST_ALLOWED = whitelistAllowed;

  let dropinMods = "";

  // Optional top-level notice when controls are disabled.
  if (!whitelistAllowed) {
    dropinMods += `<div class="mb-3 p-3 bg-yellow-800/40 rounded text-sm text-yellow-200">${Lang.queryJS('settings.dropinMods.whitelistRestricted') || 'Whitelist active — votre compte n\'est pas autorisé. Les mods personnalisés sont désactivés.'}</div>`;
  }

  for (const dropin of CACHE_DROPIN_MODS) {
    const toggleDisabledAttr = whitelistAllowed ? "" : "disabled title='Whitelist active — votre compte n\'est pas autorisé.'";
    const removeDisabledAttr = whitelistAllowed ? "" : "disabled";
    const containerDisabledClasses = whitelistAllowed ? "" : " opacity-40 cursor-not-allowed ";

    dropinMods += `<div id="${dropin.fullName}" class="settingsBaseMod settingsDropinMod ${!dropin.disabled ? "enabled" : ""} ${containerDisabledClasses}">
      <div class="settingsModContent p-4 bg-gray-800/80 border border-gray-700 rounded-lg shadow-lg mb-3 group hover:bg-gray-800 transition-all">
        <div class="flex items-center justify-between gap-4">
          <!-- Left: Status + Name -->
          <div class="flex items-center gap-3 flex-1 min-w-0">
            <div class="settingsModStatus w-3 h-3 ${!dropin.disabled ? "bg-green-500" : "bg-red-500"} rounded-full flex-shrink-0 shadow-lg ${!dropin.disabled ? "shadow-green-500/50" : "shadow-red-500/50"}"></div>
            <div class="settingsModDetails flex-1 min-w-0">
              <div class="settingsModName text-base font-semibold text-white truncate">${dropin.name}</div>
              <div class="text-xs text-gray-400 mt-0.5">${dropin.disabled ? 'Disabled' : 'Enabled'}</div>
            </div>
          </div>
          
          <!-- Right: Toggle + Remove Button -->
          <div class="flex items-center gap-3 flex-shrink-0">
            <label class="toggleSwitch relative inline-block">
              <input type="checkbox" formod="${dropin.fullName}" dropin ${!dropin.disabled ? "checked" : ""} ${toggleDisabledAttr} class="sr-only peer">
              <span class="toggleSwitchSlider block w-11 h-6 bg-gray-600 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-yellow-500/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></span>
            </label>
            <button ${removeDisabledAttr} class="settingsDropinRemoveButton bg-red-600/80 hover:bg-red-600 text-white py-1.5 px-3 rounded text-sm font-medium transition-all flex items-center gap-1.5" remmod="${dropin.fullName}">
              <i class="bi bi-trash text-sm"></i>
              <span class="hidden sm:inline">${Lang.queryJS("settings.dropinMods.removeButton")}</span>
            </button>
          </div>
        </div>
      </div>
    </div>`;
  }
  
  document.getElementById("settingsDropinModsContent").innerHTML = dropinMods;
}

/**
 * Bind the remove button for each loaded drop-in mod.
 */
function bindDropinModsRemoveButton() {
  const sEls = settingsModsContainer.querySelectorAll("[remmod]");
  Array.from(sEls).map((v, index, arr) => {
    v.onclick = async () => {
      const fullName = v.getAttribute("remmod");
      const res = await DropinModUtil.deleteDropinMod(
        CACHE_SETTINGS_MODS_DIR,
        fullName
      );
      if (res) {
        document.getElementById(fullName).remove();
      } else {
        setOverlayContent(
          Lang.queryJS("settings.dropinMods.deleteFailedTitle", { fullName }),
          Lang.queryJS("settings.dropinMods.deleteFailedMessage"),
          Lang.queryJS("settings.dropinMods.okButton")
        );
        setOverlayHandler(null);
        toggleOverlay(true);
      }
    };
  });
}

/**
 * Bind functionality to the file system button for the selected
 * server configuration.
 */
function bindDropinModFileSystemButton() {
  const fsBtn = document.getElementById("settingsDropinFileSystemButton");
  // If drop-in actions are disallowed by whitelist, disable the button
  // and show an explanatory overlay instead of opening the folder.
  if (!DROPIN_WHITELIST_ALLOWED) {
    try { fsBtn.disabled = true; } catch (e) {}
    fsBtn.onclick = () => {
      setOverlayContent(
        Lang.queryJS('settings.dropinMods.whitelistRestrictedTitle') || 'Accès restreint',
        Lang.queryJS('settings.dropinMods.whitelistRestricted') || "Whitelist active — votre compte n'est pas autorisé.",
        Lang.queryJS('settings.dropinMods.okButton') || 'OK'
      );
      setOverlayHandler(() => { toggleOverlay(false); });
      toggleOverlay(true);
    };
    return;
  }

  fsBtn.onclick = () => {
    DropinModUtil.validateDir(CACHE_SETTINGS_MODS_DIR);
    shell.openPath(CACHE_SETTINGS_MODS_DIR);
  };
  fsBtn.ondragenter = (e) => {
    e.dataTransfer.dropEffect = "move";
    fsBtn.setAttribute("drag", "");
    e.preventDefault();
  };
  fsBtn.ondragover = (e) => {
    e.preventDefault();
  };
  fsBtn.ondragleave = (e) => {
    fsBtn.removeAttribute("drag");
  };

  fsBtn.ondrop = async (e) => {
    fsBtn.removeAttribute("drag");
    e.preventDefault();

    DropinModUtil.addDropinMods(e.dataTransfer.files, CACHE_SETTINGS_MODS_DIR);
    await reloadDropinMods();
  };
}

/**
 * Save drop-in mod states. Enabling and disabling is just a matter
 * of adding/removing the .disabled extension.
 */
function saveDropinModConfiguration() {
  for (dropin of CACHE_DROPIN_MODS) {
    const dropinUI = document.getElementById(dropin.fullName);
    if (dropinUI != null) {
      const dropinUIEnabled = dropinUI.hasAttribute("enabled");
      if (
        DropinModUtil.isDropinModEnabled(dropin.fullName) != dropinUIEnabled
      ) {
        DropinModUtil.toggleDropinMod(
          CACHE_SETTINGS_MODS_DIR,
          dropin.fullName,
          dropinUIEnabled
        ).catch((err) => {
          if (!isOverlayVisible()) {
            setOverlayContent(
              Lang.queryJS("settings.dropinMods.failedToggleTitle"),
              err.message,
              Lang.queryJS("settings.dropinMods.okButton")
            );
            setOverlayHandler(null);
            toggleOverlay(true);
          }
        });
      }
    }
  }
}

// Refresh the drop-in mods when F5 is pressed.
// Only active on the mods tab.
document.addEventListener("keydown", async (e) => {
  if (
    getCurrentView() === VIEWS.settings &&
    selectedSettingsTab === "settingsTabMods"
  ) {
    if (e.key === "F5") {
      await reloadDropinMods();
      saveShaderpackSettings();
      await resolveShaderpacksForUI();
    }
  }
});

async function reloadDropinMods() {
  await resolveDropinModsForUI();
  bindDropinModsRemoveButton();
  bindDropinModFileSystemButton();
  bindModsToggleSwitch();
}

// Shaderpack

let CACHE_SETTINGS_INSTANCE_DIR;
let CACHE_SHADERPACKS;
let CACHE_SELECTED_SHADERPACK;

/**
 * Load shaderpack information.
 */
async function resolveShaderpacksForUI() {
  const serv = (await DistroAPI.getDistribution()).getServerById(
    ConfigManager.getSelectedServer()
  );
  CACHE_SETTINGS_INSTANCE_DIR = path.join(
    ConfigManager.getInstanceDirectory(),
    serv.rawServer.id
  );
  CACHE_SHADERPACKS = DropinModUtil.scanForShaderpacks(
    CACHE_SETTINGS_INSTANCE_DIR
  );
  CACHE_SELECTED_SHADERPACK = DropinModUtil.getEnabledShaderpack(
    CACHE_SETTINGS_INSTANCE_DIR
  );

  setShadersOptions(CACHE_SHADERPACKS, CACHE_SELECTED_SHADERPACK);
}

function setShadersOptions(arr, selected) {
  const cont = document.getElementById("settingsShadersOptions");
  cont.innerHTML = "";
  for (let opt of arr) {
    const d = document.createElement("DIV");
    d.innerHTML = opt.name;
    d.setAttribute("value", opt.fullName);
    if (opt.fullName === selected) {
      d.setAttribute("selected", "");
      document.getElementById("settingsShadersSelected").innerHTML = opt.name;
    }
    d.addEventListener("click", function (e) {
      this.parentNode.previousElementSibling.innerHTML = this.innerHTML;
      for (let sib of this.parentNode.children) {
        sib.removeAttribute("selected");
      }
      this.setAttribute("selected", "");
      closeSettingsSelect();
    });
    cont.appendChild(d);
  }
}

function saveShaderpackSettings() {
  let sel = "OFF";
  for (let opt of document.getElementById("settingsShadersOptions")
    .childNodes) {
    if (opt.hasAttribute("selected")) {
      sel = opt.getAttribute("value");
    }
  }
  DropinModUtil.setEnabledShaderpack(CACHE_SETTINGS_INSTANCE_DIR, sel);
}

function bindShaderpackButton() {
  const spBtn = document.getElementById("settingsShaderpackButton");
  spBtn.onclick = () => {
    const p = path.join(CACHE_SETTINGS_INSTANCE_DIR, "shaderpacks");
    DropinModUtil.validateDir(p);
    shell.openPath(p);
  };
  spBtn.ondragenter = (e) => {
    e.dataTransfer.dropEffect = "move";
    spBtn.setAttribute("drag", "");
    e.preventDefault();
  };
  spBtn.ondragover = (e) => {
    e.preventDefault();
  };
  spBtn.ondragleave = (e) => {
    spBtn.removeAttribute("drag");
  };

  spBtn.ondrop = async (e) => {
    spBtn.removeAttribute("drag");
    e.preventDefault();

    DropinModUtil.addShaderpacks(
      e.dataTransfer.files,
      CACHE_SETTINGS_INSTANCE_DIR
    );
    saveShaderpackSettings();
    await resolveShaderpacksForUI();
  };
}

/**
 * Bind the force download check button.
 */
function bindForceDownloadButton() {
  const forceBtn = document.getElementById("settingsForceDownloadButton");
  if (!forceBtn) return;
  
  forceBtn.onclick = async () => {
    forceBtn.disabled = true;
    forceBtn.innerHTML = Lang.queryJS("settings.forceDownloadButton") || "Vérification...";
    
    try {
      await forceModsDownloadCheck();
    } catch (err) {
      setOverlayContent(
        Lang.queryJS("settings.forceDownload.errorTitle") || "Erreur",
        err && err.message ? err.message : "Erreur lors de la vérification forcée.",
        Lang.queryJS("settings.forceDownload.okButton") || "OK"
      );
      setOverlayHandler(() => {
        toggleOverlay(false);
      });
      toggleOverlay(true);
    } finally {
      forceBtn.disabled = false;
      forceBtn.innerHTML = Lang.queryJS("settings.forceDownloadButton") || "Vérifier";
    }
  };
}

/**
 * Bind the force download button to trigger mod validation.
 */
function bindForceDownloadButton() {
  const forceBtn = document.getElementById("settingsForceDownloadButton");
  if (!forceBtn) return;
  
  forceBtn.onclick = () => {
    forceModsDownloadCheck();
  };
}

// Server status bar functions.

/**
 * Load the currently selected server information onto the mods tab.
 */
async function loadSelectedServerOnModsTab() {
  const serv = (await DistroAPI.getDistribution()).getServerById(
    ConfigManager.getSelectedServer()
  );

  for (const el of document.getElementsByClassName("settingsSelServContent")) {
    el.innerHTML = `
            <img class="serverListingImg w-16 h-16 rounded-full mr-4" src="${serv.rawServer.icon}"/>
            <div class="serverListingDetails flex flex-col">
                <span class="serverListingName text-lg font-bold text-white">${serv.rawServer.name}</span>
                <span class="serverListingDescription text-sm group-hover:text-white text-gray-400">${
                  serv.rawServer.description
                }</span>
                <div class="serverListingInfo flex items-center mt-2 space-x-4">
                    <div class="serverListingVersion text-sm text-gray-300">${
                      serv.rawServer.minecraftVersion
                    }</div>
                    <div class="serverListingRevision text-sm text-gray-300">${
                      serv.rawServer.version
                    }</div>
                    
                </div>
            </div>
        `;
  }
}

// Bind functionality to the server switch button.
Array.from(
  document.getElementsByClassName("settingsSwitchServerButton")
).forEach((el) => {
  el.addEventListener("click", async (e) => {
    e.target.blur();
    await toggleServerSelection(true);
  });
});

/**
 * Save mod configuration for the current selected server.
 */
function saveAllModConfigurations() {
  saveModConfiguration();
  ConfigManager.save();
  saveDropinModConfiguration();
}

/**
 * Function to refresh the current tab whenever the selected
 * server is changed.
 */
function animateSettingsTabRefresh() {
  // Refresh current tab content without visual animations.
  // Hide immediately, refresh, then show immediately to avoid transitions.
  $(`#${selectedSettingsTab}`).hide(0, async () => {
    await prepareSettings();
    $(`#${selectedSettingsTab}`).show(0);
  });
}

/**
 * Prepare the Mods tab for display.
 */
async function prepareModsTab(first) {
  await resolveModsForUI();
  await resolveDropinModsForUI();
  await resolveShaderpacksForUI();
  bindDropinModsRemoveButton();
  bindDropinModFileSystemButton();
  bindShaderpackButton();
  bindModsToggleSwitch();
  ensureRequiredModsEnabled();
  bindForceDownloadButton();
  await loadSelectedServerOnModsTab();
}

/**
 * Java Tab
 */

// DOM getters for Java tab elements — query at runtime to avoid early access
function getSettingsMaxRAMRange() { return document.getElementById("settingsMaxRAMRange"); }
function getSettingsMinRAMRange() { return document.getElementById("settingsMinRAMRange"); }
function getSettingsMaxRAMLabel() { return document.getElementById("settingsMaxRAMLabel"); }
function getSettingsMinRAMLabel() { return document.getElementById("settingsMinRAMLabel"); }
function getSettingsMemoryTotal() { return document.getElementById("settingsMemoryTotal"); }
function getSettingsMemoryAvail() { return document.getElementById("settingsMemoryAvail"); }
function getSettingsJavaExecDetails() { return document.getElementById("settingsJavaExecDetails"); }
function getSettingsJavaReqDesc() { return document.getElementById("settingsJavaReqDesc"); }
function getSettingsJvmOptsLink() { return document.getElementById("settingsJvmOptsLink"); }

// Bind a performant double-range control for Min/Max RAM.
function bindDoubleRangeControls() {
  const minInput = getSettingsMinRAMRange();
  const maxInput = getSettingsMaxRAMRange();
  const minThumb = document.getElementById('settingsMinThumb');
  const maxThumb = document.getElementById('settingsMaxThumb');
  const track = document.querySelector('.double-range-track');
  const fillEl = document.getElementById('settingsRangeFill');
  const minLabel = getSettingsMinRAMLabel();
  const maxLabel = getSettingsMaxRAMLabel();
  if (!minInput || !maxInput || !minThumb || !maxThumb || !track || !fillEl) return;

  const minAttr = Number(minInput.getAttribute('min') || 0);
  const maxAttr = Number(minInput.getAttribute('max') || 100);
  const step = Number(minInput.getAttribute('step') || 1);

  function valueToPercent(v) {
    return ((v - minAttr) / (maxAttr - minAttr)) * 100;
  }
  function percentToValue(p) {
    const raw = minAttr + (p / 100) * (maxAttr - minAttr);
    const steps = Math.round((raw - minAttr) / step);
    let v = minAttr + steps * step;
    v = Math.max(minAttr, Math.min(maxAttr, Number(v.toFixed(3))));
    return v;
  }

  function fmtGb(v) {
    return Number(v) % 1 === 0 ? `${Number(v)}G` : `${Number(v).toFixed(1)}G`;
  }

  function updatePositions() {
    const a = Number(minInput.value);
    const b = Number(maxInput.value);
    const low = Math.min(a, b);
    const high = Math.max(a, b);
    const left = valueToPercent(low);
    const right = valueToPercent(high);
    fillEl.style.left = left + '%';
    fillEl.style.width = Math.max(0, right - left) + '%';
    minThumb.style.left = valueToPercent(a) + '%';
    maxThumb.style.left = valueToPercent(b) + '%';
    if (minLabel) minLabel.innerText = fmtGb(a);
    if (maxLabel) maxLabel.innerText = fmtGb(b);
  }

  // initialize
  updatePositions();

  let active = null;
  function onPointerMove(e) {
    if (!active) return;
    const rect = track.getBoundingClientRect();
    let p = ((e.clientX - rect.left) / rect.width) * 100;
    p = Math.max(0, Math.min(100, p));
    const v = percentToValue(p);
    if (active === minThumb) {
      const maxV = Number(maxInput.value);
      const newV = Math.min(v, maxV);
      minInput.value = newV;
    } else {
      const minV = Number(minInput.value);
      const newV = Math.max(v, minV);
      maxInput.value = newV;
    }
    updatePositions();
  }

  function onPointerUp(e) {
    if (!active) return;
    try { active.releasePointerCapture(e.pointerId); } catch (err) {}
    active.classList.remove('dragging');
    active.style.zIndex = '';
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    active = null;
  }

  function onPointerDownThumb(e) {
    e.preventDefault();
    active = e.currentTarget;
    active.setPointerCapture && active.setPointerCapture(e.pointerId);
    active.classList.add('dragging');
    active.style.zIndex = 30;
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  }

  minThumb.addEventListener('pointerdown', onPointerDownThumb);
  maxThumb.addEventListener('pointerdown', onPointerDownThumb);

  // keyboard support
  function onThumbKey(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const delta = e.key === 'ArrowRight' ? step : -step;
    if (e.currentTarget === minThumb) {
      let v = Number(minInput.value) + delta;
      v = Math.max(minAttr, Math.min(Number(maxInput.value), v));
      minInput.value = v;
    } else {
      let v = Number(maxInput.value) + delta;
      v = Math.min(maxAttr, Math.max(Number(minInput.value), v));
      maxInput.value = v;
    }
    updatePositions();
  }

  minThumb.tabIndex = 0;
  maxThumb.tabIndex = 0;
  minThumb.addEventListener('keydown', onThumbKey);
  maxThumb.addEventListener('keydown', onThumbKey);

  // keep visuals in sync if inputs change programmatically
  minInput.addEventListener('input', updatePositions);
  maxInput.addEventListener('input', updatePositions);
  minInput.addEventListener('change', updatePositions);
  maxInput.addEventListener('change', updatePositions);
}

/**
 * Calculate common values for a ranged slider.
 *
 * @param {Element} v The range slider to calculate against.
 * @returns {Object} An object with meta values for the provided ranged slider.
 */
function calculateRangeSliderMeta(v) {
  const val = {
    max: Number(v.getAttribute("max")),
    min: Number(v.getAttribute("min")),
    step: Number(v.getAttribute("step")),
  };
  val.ticks = (val.max - val.min) / val.step;
  val.inc = 100 / val.ticks;
  return val;
}

/**
 * Binds functionality to the ranged sliders. They're more than
 * just divs now :').
 */
function bindRangeSlider() {
  Array.from(document.getElementsByClassName("rangeSlider")).map((v) => {
    // If this is an INPUT range, bind input/change listeners.
    if (v.tagName === "INPUT") {
      const sliderMeta = calculateRangeSliderMeta(v);
      // initialize display
      const value = Number(v.value || v.getAttribute("value") || sliderMeta.min);
      updateRangedSlider(v, value, ((value - sliderMeta.min) / sliderMeta.step) * sliderMeta.inc);

      v.addEventListener("input", (e) => {
        const val = Number(e.target.value);
        const notch = ((val - sliderMeta.min) / sliderMeta.step) * sliderMeta.inc;
        updateRangedSlider(v, val, notch);
        updateDoubleRangeFill();
      });
      v.addEventListener("change", (e) => {
        const val = Number(e.target.value);
        const notch = ((val - sliderMeta.min) / sliderMeta.step) * sliderMeta.inc;
        updateRangedSlider(v, val, notch);
        updateDoubleRangeFill();
      });
      return;
    }

    // Reference the track (thumb) for DIV-based sliders.
    const track = v.getElementsByClassName("rangeSliderTrack")[0];

    // Set the initial slider value.
    const value = v.getAttribute("value");
    const sliderMeta = calculateRangeSliderMeta(v);

    updateRangedSlider(
      v,
      value,
      ((value - sliderMeta.min) / sliderMeta.step) * sliderMeta.inc
    );

    // The magic happens when we click on the track.
    if (track) {
      track.onmousedown = (e) => {
        // Stop moving the track on mouse up.
        document.onmouseup = (e) => {
          document.onmousemove = null;
          document.onmouseup = null;
        };

        // Move slider according to the mouse position.
        document.onmousemove = (e) => {
          // Distance from the beginning of the bar in pixels.
          const diff = e.pageX - v.offsetLeft - track.offsetWidth / 2;

          // Don't move the track off the bar.
          if (diff >= 0 && diff <= v.offsetWidth - track.offsetWidth / 2) {
            // Convert the difference to a percentage.
            const perc = (diff / v.offsetWidth) * 100;
            // Calculate the percentage of the closest notch.
            const notch = Number(perc / sliderMeta.inc).toFixed(0) * sliderMeta.inc;

            // If we're close to that notch, stick to it.
            if (Math.abs(perc - notch) < sliderMeta.inc / 2) {
              updateRangedSlider(
                v,
                sliderMeta.min + sliderMeta.step * (notch / sliderMeta.inc),
                notch
              );
            }
          }
        };
      };
    }
  });

  // Initial draw for double-range fill (if both inputs present)
  updateDoubleRangeFill();
}

/**
 * Update a ranged slider's value and position.
 *
 * @param {Element} element The ranged slider to update.
 * @param {string | number} value The new value for the ranged slider.
 * @param {number} notch The notch that the slider should now be at.
 */
function updateRangedSlider(element, value, notch) {
  const oldVal = element.getAttribute && element.getAttribute("value");
  const bar = element.getElementsByClassName ? element.getElementsByClassName("rangeSliderBar")[0] : null;
  const track = element.getElementsByClassName ? element.getElementsByClassName("rangeSliderTrack")[0] : null;

  // Update the stored value (for DIVs) or real value (for INPUTs)
  if (element.tagName === "INPUT") {
    element.value = value;
  } else if (element.setAttribute) {
    element.setAttribute("value", value);
  }

  if (notch < 0) notch = 0;
  else if (notch > 100) notch = 100;

  // Apply visual changes directly. Avoid dispatching a synthetic 'change' event
  // here because it can trigger other listeners synchronously and cause
  // heavy cascading updates (leading to input lag). If other modules need a
  // programmatic notification they should call a dedicated API.
  try {
    if (track && track.style) track.style.left = notch + "%";
    if (bar && bar.style) bar.style.width = notch + "%";

    // For inputs, emulate a progress bar using background gradient
    if (element.tagName === "INPUT") {
      element.style.background = `linear-gradient(90deg, rgba(59,130,246,0.6) ${notch}%, rgba(255,255,255,0.04) ${notch}%)`;
    }
  } catch (e) {
    // Ignore visual errors; don't revert value — keep the input state consistent.
  }
}

/**
 * Update the visual filled area between the two RAM range thumbs.
 * This draws the blue segment between the min and max thumbs.
 */
function updateDoubleRangeFill() {
  // Batch fill updates via requestAnimationFrame to avoid layout thrashing
  if (updateDoubleRangeFill._scheduled) return;
  updateDoubleRangeFill._scheduled = true;
  requestAnimationFrame(() => {
    updateDoubleRangeFill._scheduled = false;
    try {
      const minEl = getSettingsMinRAMRange();
      const maxEl = getSettingsMaxRAMRange();
      const fill = document.getElementById("settingsRangeFill");
      if (!minEl || !maxEl || !fill) return;

      const minAttr = Number(minEl.getAttribute("min") || 0);
      const maxAttr = Number(minEl.getAttribute("max") || 100);
      const a = Number(minEl.tagName === "INPUT" ? minEl.value : minEl.getAttribute("value"));
      const b = Number(maxEl.tagName === "INPUT" ? maxEl.value : maxEl.getAttribute("value"));
      const low = Math.min(a, b);
      const high = Math.max(a, b);
      const left = ((low - minAttr) / (maxAttr - minAttr)) * 100;
      const right = ((high - minAttr) / (maxAttr - minAttr)) * 100;
      fill.style.left = left + "%";
      fill.style.width = Math.max(0, right - left) + "%";
    } catch (e) {
      // ignore visual update errors
    }
  });
}

/**
 * Display the total and available RAM.
 */
function populateMemoryStatus() {
  const totalEl = getSettingsMemoryTotal();
  const availEl = getSettingsMemoryAvail();
  if (totalEl) totalEl.innerHTML = Number((os.totalmem() - 1073741824) / 1073741824).toFixed(1) + "G";
  if (availEl) availEl.innerHTML = Number(os.freemem() / 1073741824).toFixed(1) + "G";
}

/**
 * Validate the provided executable path and display the data on
 * the UI.
 *
 * @param {string} execPath The executable path to populate against.
 */
async function populateJavaExecDetails(execPath) {
  const server = (await DistroAPI.getDistribution()).getServerById(
    ConfigManager.getSelectedServer()
  );

  const details = await validateSelectedJvm(
    ensureJavaDirIsRoot(execPath),
    server.effectiveJavaOptions.supported
  );

  const detailsEl = getSettingsJavaExecDetails();
  if (details != null) {
    if (detailsEl) detailsEl.innerHTML = Lang.queryJS(
      "settings.java.selectedJava",
      { version: details.semverStr, vendor: details.vendor }
    );
  } else {
    if (detailsEl) detailsEl.innerHTML = Lang.queryJS(
      "settings.java.invalidSelection"
    );
  }
}

function populateJavaReqDesc(server) {
  settingsJavaReqDesc.innerHTML = Lang.queryJS("settings.java.requiresJava", {
    major: server.effectiveJavaOptions.suggestedMajor,
  });
}

function populateJvmOptsLink(server) {
  const major = server.effectiveJavaOptions.suggestedMajor;
  settingsJvmOptsLink.innerHTML = Lang.queryJS(
    "settings.java.availableOptions",
    { major: major }
  );
  if (major >= 12) {
    settingsJvmOptsLink.href = `https://docs.oracle.com/en/java/javase/${major}/docs/specs/man/java.html#extra-options-for-java`;
  } else if (major >= 11) {
    settingsJvmOptsLink.href =
      "https://docs.oracle.com/en/java/javase/11/tools/java.html#GUID-3B1CE181-CD30-4178-9602-230B800D4FAE";
  } else if (major >= 9) {
    settingsJvmOptsLink.href = `https://docs.oracle.com/javase/${major}/tools/java.htm`;
  } else {
    settingsJvmOptsLink.href = `https://docs.oracle.com/javase/${major}/docs/technotes/tools/${
      process.platform === "win32" ? "windows" : "unix"
    }/java.html`;
  }
}

function bindMinMaxRam(server) {
  // Store maximum memory values.
  const SETTINGS_MAX_MEMORY = ConfigManager.getAbsoluteMaxRAM(
    server.rawServer.javaOptions?.ram
  );
  const SETTINGS_MIN_MEMORY = ConfigManager.getAbsoluteMinRAM(
    server.rawServer.javaOptions?.ram
  );
  // Set the max and min values for the ranged sliders (use getters).
  const maxEl = getSettingsMaxRAMRange();
  const minEl = getSettingsMinRAMRange();
  if (maxEl) {
    maxEl.setAttribute("max", SETTINGS_MAX_MEMORY);
    maxEl.setAttribute("min", SETTINGS_MIN_MEMORY);
  }
  if (minEl) {
    minEl.setAttribute("max", SETTINGS_MAX_MEMORY);
    minEl.setAttribute("min", SETTINGS_MIN_MEMORY);
  }
}

/**
 * Prepare the Java tab for display.
 */
async function prepareJavaTab() {
  const server = (await DistroAPI.getDistribution()).getServerById(
    ConfigManager.getSelectedServer()
  );
  bindMinMaxRam(server);
  bindRangeSlider(server);
  bindDoubleRangeControls();
  populateMemoryStatus();
  populateJavaReqDesc(server);
  populateJvmOptsLink(server);
}

/**
 * About Tab
 */

const settingsTabAbout = document.getElementById("settingsTabAbout");
const settingsAboutChangelogTitle = settingsTabAbout.getElementsByClassName(
  "settingsChangelogTitle"
)[0];
const settingsAboutChangelogText = settingsTabAbout.getElementsByClassName(
  "settingsChangelogText"
)[0];
const settingsAboutChangelogButton = settingsTabAbout.getElementsByClassName(
  "settingsChangelogButton"
)[0];

// Bind the devtools toggle button.
document.getElementById("settingsAboutDevToolsButton").onclick = (e) => {
  let window = remote.getCurrentWindow();
  window.toggleDevTools();
};

/**
 * Return whether or not the provided version is a prerelease.
 *
 * @param {string} version The semver version to test.
 * @returns {boolean} True if the version is a prerelease, otherwise false.
 */
function isPrerelease(version) {
  const preRelComp = semver.prerelease(version);
  return preRelComp != null && preRelComp.length > 0;
}

/**
 * Utility method to display version information on the
 * About and Update settings tabs.
 *
 * @param {string} version The semver version to display.
 * @param {Element} valueElement The value element.
 * @param {Element} titleElement The title element.
 * @param {Element} checkElement The check mark element.
 */
function populateVersionInformation(
  version,
  valueElement,
  titleElement,
  checkElement
) {
  // Be defensive: caller may pass null elements if the DOM isn't present.
  if (valueElement) {
    valueElement.innerHTML = version;
  }

  if (isPrerelease(version)) {
    if (titleElement) {
      titleElement.innerHTML = Lang.queryJS("settings.about.preReleaseTitle");
      titleElement.style.color = "#ff886d";
    }
    if (checkElement) {
      checkElement.style.background = "#ff886d";
    }
  } else {
    if (titleElement) {
      titleElement.innerHTML = Lang.queryJS("settings.about.stableReleaseTitle");
      titleElement.style.color = null;
    }
    if (checkElement) {
      checkElement.style.background = null;
    }
  }
}

/**
 * Retrieve the version information and display it on the UI.
 */
function populateAboutVersionInformation() {
  populateVersionInformation(
    remote.app.getVersion(),
    document.getElementById("settingsAboutCurrentVersionValue"),
    document.getElementById("settingsAboutCurrentVersionTitle"),
    document.getElementById("settingsAboutCurrentVersionCheck")
  );
}

/**
 * Fetches the GitHub atom release feed and parses it for the release notes
 * of the current version. This value is displayed on the UI.
 */
function populateReleaseNotes() {
  $.ajax({
    url: "https://github.com/Multigames-Studio-fr/Multigames-studio-lancheur/releases.atom",
    success: (data) => {
      const version = "v" + remote.app.getVersion();
      const entries = $(data).find("entry");

      for (let i = 0; i < entries.length; i++) {
        const entry = $(entries[i]);
        let id = entry.find("id").text();
        id = id.substring(id.lastIndexOf("/") + 1);

        if (id === version) {
          settingsAboutChangelogTitle.innerHTML = entry.find("title").text();
          settingsAboutChangelogText.innerHTML = entry.find("content").text();
          settingsAboutChangelogButton.href = entry.find("link").attr("href");
        }
      }
    },
    timeout: 2500,
  }).catch((err) => {
    settingsAboutChangelogText.innerHTML = Lang.queryJS(
      "settings.about.releaseNotesFailed"
    );
  });
}

/**
 * Prepare account tab for display.
 */
function prepareAboutTab() {
  populateAboutVersionInformation();
  populateReleaseNotes();
}

/**
 * Update Tab
 *
 * Note: the Update UI was moved into the About tab (id="#settingsAboutUpdates").
 * Historically this module assumed an element with id "settingsTabUpdate" existed
 * and attempted to access children immediately which will throw if the element
 * is missing. To support both old and new layouts we only query DOM elements
 * defensively at runtime (document.getElementById) and avoid dereferencing a
 * possibly-null wrapper element.
 */

const settingsUpdateTitle = document.getElementById("settingsUpdateTitle");
const settingsUpdateVersionCheck = document.getElementById(
  "settingsUpdateVersionCheck"
);
const settingsUpdateVersionTitle = document.getElementById(
  "settingsUpdateVersionTitle"
);
const settingsUpdateVersionValue = document.getElementById(
  "settingsUpdateVersionValue"
);
const settingsUpdateActionButton = document.getElementById(
  "settingsUpdateActionButton"
);
const settingsUpdateProgressContainer = document.getElementById("settingsUpdateProgressContainer");
const settingsUpdateProgressBar = document.getElementById("settingsUpdateProgressBar");
const settingsUpdateProgressLabel = document.getElementById("settingsUpdateProgressLabel");

// Listen for auto update notifications to update the settings UI accordingly
try {
  ipcRenderer.on("autoUpdateNotification", (event, arg, info) => {
    try {
      switch (arg) {
        case "download-progress": {
          // Show progress on the button text
          try {
            // Show progress UI
            if (settingsUpdateProgressContainer) settingsUpdateProgressContainer.classList.remove('hidden');
            const percent = info && (info.percent || info.percent === 0) ? Math.round(info.percent) : null;
            const p = percent != null ? percent : null;
            if (p != null) {
              if (settingsUpdateProgressBar) settingsUpdateProgressBar.style.width = Math.min(100, Math.max(0, p)) + '%';
              if (settingsUpdateProgressLabel) settingsUpdateProgressLabel.innerText = `${p}%`;
              settingsUpdateButtonStatus(Lang.queryJS("settings.updates.downloadingButton") + ` (${p}%)`, true);
            } else {
              if (settingsUpdateProgressBar) settingsUpdateProgressBar.style.width = '0%';
              if (settingsUpdateProgressLabel) settingsUpdateProgressLabel.innerText = '...';
              settingsUpdateButtonStatus(Lang.queryJS("settings.updates.downloadingButton"), true);
            }
          } catch (e) {
            settingsUpdateButtonStatus(Lang.queryJS("settings.updates.downloadingButton"), true);
          }
          break;
        }
        case "update-downloaded": {
          // Enable install now action
          // Hide progress UI
          try { if (settingsUpdateProgressContainer) settingsUpdateProgressContainer.classList.add('hidden'); } catch (e) {}

          settingsUpdateButtonStatus(Lang.queryJS("settings.updates.installNowButton"), false, () => {
            if (!isDev) {
              ipcRenderer.send("autoUpdateAction", "installUpdateNow");
            }
          });
          break;
        }
        case "realerror": {
          // On error, revert button to check for updates
          // Hide progress UI
          try { if (settingsUpdateProgressContainer) settingsUpdateProgressContainer.classList.add('hidden'); } catch (e) {}

          settingsUpdateButtonStatus(Lang.queryJS("settings.updates.checkForUpdatesButton"), false, () => {
            if (!isDev) {
              ipcRenderer.send("autoUpdateAction", "checkForUpdate");
              settingsUpdateButtonStatus(Lang.queryJS("settings.updates.checkingForUpdatesButton"), true);
            }
          });
          break;
        }
        default:
          break;
      }
    } catch (e) {
      // ignore UI listener errors
    }
  });
} catch (e) {
  // ignore if ipcRenderer not available
}

/**
 * Update the properties of the update action button.
 *
 * @param {string} text The new button text.
 * @param {boolean} disabled Optional. Disable or enable the button
 * @param {function} handler Optional. New button event handler.
 */
function settingsUpdateButtonStatus(text, disabled = false, handler = null) {
  // Always query the DOM at call-time to avoid accessing variables that
  // may be in the temporal-dead-zone if this module is executed before
  // the settings DOM is mounted. If the button is not present, silently return.
  const btn = document.getElementById("settingsUpdateActionButton");
  if (!btn) return;
  btn.innerHTML = text;
  btn.disabled = disabled;
  if (handler != null) {
    btn.onclick = handler;
  }
}

/**
 * Populate the update tab with relevant information.
 *
 * @param {Object} data The update data.
 */
function populateSettingsUpdateInformation(data) {
  // Query DOM elements at runtime in case the settings DOM hasn't been
  // mounted when this module was initially executed. If the update
  // tab is not found, try the About updates card used after UI refactor.
  let tab = document.getElementById("settingsTabUpdate");
  if (!tab) tab = document.getElementById("settingsAboutUpdates");
  if (!tab) return;

  const titleEl = document.getElementById("settingsUpdateTitle");
  const versionCheckEl = document.getElementById(
    "settingsUpdateVersionCheck"
  );
  const versionTitleEl = document.getElementById(
    "settingsUpdateVersionTitle"
  );
  const versionValueEl = document.getElementById(
    "settingsUpdateVersionValue"
  );
  const changelogTitleEl = tab.getElementsByClassName("settingsChangelogTitle")[0];
  const changelogTextEl = tab.getElementsByClassName("settingsChangelogText")[0];
  const changelogContEl = tab.getElementsByClassName("settingsChangelogContainer")[0];

  if (data != null) {
    if (titleEl) {
      titleEl.innerHTML = isPrerelease(data.version)
        ? Lang.queryJS("settings.updates.newPreReleaseTitle")
        : Lang.queryJS("settings.updates.newReleaseTitle");
    }
    if (changelogContEl) changelogContEl.style.display = null;
    if (changelogTitleEl) changelogTitleEl.innerHTML = data.releaseName;
    if (changelogTextEl) changelogTextEl.innerHTML = data.releaseNotes;
    populateVersionInformation(
      data.version,
      versionValueEl,
      versionTitleEl,
      versionCheckEl
    );

    if (process.platform === "darwin") {
      settingsUpdateButtonStatus(
        Lang.queryJS("settings.updates.downloadButton"),
        false,
        () => {
          shell.openExternal(data.darwindownload);
        }
      );
    } else {
      // Provide explicit "Download" action for non-mac platforms.
      settingsUpdateButtonStatus(
        Lang.queryJS("settings.updates.downloadButton"),
        false,
        () => {
          // Disable button and show downloading state immediately.
          settingsUpdateButtonStatus(
            Lang.queryJS("settings.updates.downloadingButton"),
            true
          );
          ipcRenderer.send("autoUpdateAction", "downloadUpdate");
        }
      );
    }
  } else {
    if (titleEl)
      titleEl.innerHTML = Lang.queryJS("settings.updates.latestVersionTitle");
    if (changelogContEl) changelogContEl.style.display = "none";
    populateVersionInformation(
      remote.app.getVersion(),
      versionValueEl,
      versionTitleEl,
      versionCheckEl
    );
    settingsUpdateButtonStatus(
      Lang.queryJS("settings.updates.checkForUpdatesButton"),
      false,
      () => {
        if (!isDev) {
          ipcRenderer.send("autoUpdateAction", "checkForUpdate");
          settingsUpdateButtonStatus(
            Lang.queryJS("settings.updates.checkingForUpdatesButton"),
            true
          );
        }
      }
    );
  }
}

/**
 * Prepare update tab for display.
 *
 * @param {Object} data The update data.
 */
function prepareUpdateTab(data = null) {
  populateSettingsUpdateInformation(data);
}

/**
 * Settings preparation functions.
 */

/**
 * Prepare the entire settings UI.
 *
 * @param {boolean} first Whether or not it is the first load.
 */
async function prepareSettings(first = false) {
  if (first) {
    setupSettingsTabs();
    initSettingsValidators();
    prepareUpdateTab();
  } else {
    await prepareModsTab();
  }
  await initSettingsValues();
  prepareAccountsTab();
  await prepareJavaTab();
  prepareAboutTab();
  prepareResourcePacksTab();
}

/**
 * Prepare the resource packs tab.
 */
function prepareResourcePacksTab() {
  // Resource pack settings system has been removed.
  // This stub prevents attempts to load the removed module.
}

// Prepare the settings UI on startup.
//prepareSettings(true)
