const fs = require("fs-extra");
const _LoggerUtil = (typeof window !== 'undefined' && window.LoggerUtil) || (function(){
  try { const _hc = require('helios-core'); if(_hc && _hc.LoggerUtil){ if(typeof window !== 'undefined') window.LoggerUtil = _hc.LoggerUtil; return _hc.LoggerUtil } } catch(e) {}
  return null
})()
const logger = (_LoggerUtil && typeof _LoggerUtil.getLogger === 'function') ? _LoggerUtil.getLogger('ConfigManager') : console
const os = require("os");
const path = require("path");
const SqlStorage = require('./sqlstorage')

const sysRoot =
  process.env.APPDATA ||
  (process.platform == "darwin"
    ? process.env.HOME + "/Library/Application Support"
    : process.env.HOME);

const dataPath = path.join(sysRoot, ".multigames");

// Determine launcher directory in a way that works both from the main
// process and from renderer windows using @electron/remote.
// Prefer an explicit environment variable set by the main process so both main
// and renderer contexts resolve to the same `userData` path. Fall back to
// electron APIs and finally to a dot-folder under the user's home.
let launcherDir = process.env.LAUNCHER_USERDATA || null
try {
  if (!launcherDir) {
    const { app } = require('electron')
    if (app && typeof app.getPath === 'function') {
      launcherDir = app.getPath('userData')
    }
  }
} catch (e) {
  // ignore - fallback to remote
}

if (!launcherDir) {
  try {
    // In renderer contexts where remote is enabled, fallback to @electron/remote
    const remoteApp = require('@electron/remote').app
    if (remoteApp && typeof remoteApp.getPath === 'function') {
      launcherDir = remoteApp.getPath('userData')
    }
  } catch (e) {
    // Last-resort fallback: use a path under the user's home directory
    launcherDir = path.join(sysRoot, '.multigames')
  }
}

/**
 * Retrieve the absolute path of the launcher directory.
 *
 * @returns {string} The absolute path of the launcher directory.
 */
exports.getLauncherDirectory = function () {
  return launcherDir;
};

/**
 * Get the launcher's data directory. This is where all files related
 * to game launch are installed (common, instances, java, etc).
 *
 * @returns {string} The absolute path of the launcher's data directory.
 */
exports.getDataDirectory = function (def = false) {
  return !def
    ? config.settings.launcher.dataDirectory
    : DEFAULT_CONFIG.settings.launcher.dataDirectory;
};

/**
 * Set the new data directory.
 *
 * @param {string} dataDirectory The new data directory.
 */
exports.setDataDirectory = function (dataDirectory) {
  config.settings.launcher.dataDirectory = dataDirectory;
};

const configPath = path.join(exports.getLauncherDirectory(), "config.json");
const configPathLEGACY = path.join(dataPath, "config.json");
const authDbPath = path.join(exports.getLauncherDirectory(), 'auth.db')

// Determine whether this appears to be the first launch. Historically this
// was purely driven by presence of the configuration file, however when the
// application is installed using the NSIS installer we create an
// `installed.flag` marker file next to the installed executable. If that
// marker exists we should not show the first-run installation UI even if a
// config file isn't present in the user's profile yet.
let firstLaunch = !fs.existsSync(configPath) && !fs.existsSync(configPathLEGACY);
try {
  const execDir = path.dirname(process.execPath || process.argv[0] || '')
  const installedFlagPath = path.join(execDir, 'installed.flag')
  if (installedFlagPath && fs.existsSync(installedFlagPath)) {
    firstLaunch = false
  }
} catch (e) {
  // If anything goes wrong while probing for the installed flag, fall back
  // to the original behavior (i.e. treat as first launch if config missing).
}

exports.getAbsoluteMinRAM = function (ram) {
  if (ram?.minimum != null) {
    return ram.minimum / 1024;
  } else {
    // Legacy behavior
    const mem = os.totalmem();
    return mem >= 6 * 1073741824 ? 3 : 2;
  }
};

exports.getAbsoluteMaxRAM = function (ram) {
  const mem = os.totalmem();
  const gT16 = mem - 16 * 1073741824;
  return Math.floor(
    (mem -
      (gT16 > 0
        ? Number.parseInt(gT16 / 8) + (16 * 1073741824) / 4
        : mem / 4)) /
      1073741824
  );
};

function resolveSelectedRAM(ram) {
  if (ram?.recommended != null) {
    return `${ram.recommended}M`;
  } else {
    // Legacy behavior
    const mem = os.totalmem();
    return mem >= 8 * 1073741824 ? "4G" : mem >= 6 * 1073741824 ? "3G" : "2G";
  }
}

/**
 * Three types of values:
 * Static = Explicitly declared.
 * Dynamic = Calculated by a private function.
 * Resolved = Resolved externally, defaults to null.
 */
const DEFAULT_CONFIG = {
  settings: {
    game: {
      resWidth: 1280,
      resHeight: 720,
      fullscreen: false,
      autoConnect: true,
      launchDetached: true,
      // Whether to show Minecraft stdout/stderr logs inside the launcher UI when launching
      showMinecraftLogs: false,
    },
    launcher: {
      allowPrerelease: false,
      dataDirectory: dataPath,
    },
  },
  newsCache: {
    date: null,
    content: null,
    dismissed: false,
  },
  clientToken: null,
  selectedServer: null, // Resolved
  selectedAccount: null,
  authenticationDatabase: {},
  modConfigurations: [],
  javaConfig: {},
};

let config = null;
let saveInProgress = false;
let pendingSave = false;

// Persistance Utility Functions

/**
 * Save the current configuration to a file.
 * Uses a lock mechanism to prevent concurrent saves and ensure data integrity.
 */
exports.save = function () {
  // If a save is already in progress, mark that we need another save after it completes
  if (saveInProgress) {
    pendingSave = true;
    return;
  }
  
  saveInProgress = true;
  
  try {
    // Persist authenticationDatabase to sqlite for robustness
    try {
      if (SqlStorage && typeof SqlStorage.setAuthAccounts === 'function') {
        const accounts = config.authenticationDatabase || {};
        const accountCount = Object.keys(accounts).length;
        
        // Only persist if we have accounts or if we're explicitly clearing
        if (accountCount > 0 || SqlStorage.getAccountCount && SqlStorage.getAccountCount() > 0) {
          SqlStorage.setAuthAccounts(accounts);
          logger.debug('Persisted', accountCount, 'auth accounts to sqlite');
        }
      }
    } catch (e) {
      logger.warn('Failed to persist authenticationDatabase to sqlite', e && e.message);
    }
    
    // Write config to file with atomic write pattern
    const tempPath = configPath + '.tmp';
    const configJson = JSON.stringify(config, null, 4);
    
    try {
      fs.writeFileSync(tempPath, configJson, "UTF-8");
      // Rename for atomic update
      fs.renameSync(tempPath, configPath);
    } catch (atomicErr) {
      // Fallback to direct write if rename fails
      logger.debug('Atomic write failed, using direct write:', atomicErr && atomicErr.message);
      fs.writeFileSync(configPath, configJson, "UTF-8");
    }
    
  } catch (err) {
    logger.error('Failed to save config:', err && err.message);
  } finally {
    saveInProgress = false;
    
    // If another save was requested during this save, do it now
    if (pendingSave) {
      pendingSave = false;
      setImmediate(() => exports.save());
    }
  }
};

/**
 * Force an immediate save, bypassing any debouncing
 */
exports.forceSave = function() {
  pendingSave = false;
  saveInProgress = false;
  exports.save();
  
  // Also force SQL persistence
  try {
    if (SqlStorage && typeof SqlStorage.forcePersist === 'function') {
      SqlStorage.forcePersist();
    }
  } catch (e) {
    logger.debug('forcePersist not available');
  }
};

/**
 * Load the configuration into memory. If a configuration file exists,
 * that will be read and saved. Otherwise, a default configuration will
 * be generated. Note that "resolved" values default to null and will
 * need to be externally assigned.
 */
exports.load = function () {
  let doLoad = true;

  if (!fs.existsSync(configPath)) {
    // Create all parent directories.
    fs.ensureDirSync(path.join(configPath, ".."));
    if (fs.existsSync(configPathLEGACY)) {
      fs.moveSync(configPathLEGACY, configPath);
    } else {
      doLoad = false;
      config = DEFAULT_CONFIG;
      exports.save();
    }
  }
  if (doLoad) {
    let doValidate = false;
    try {
      config = JSON.parse(fs.readFileSync(configPath, "UTF-8"));
      doValidate = true;
    } catch (err) {
      logger.error(err);
      logger.info("Configuration file contains malformed JSON or is corrupt.");
      logger.info("Generating a new configuration file.");
      fs.ensureDirSync(path.join(configPath, ".."));
      config = DEFAULT_CONFIG;
      exports.save();
    }
    if (doValidate) {
      config = validateKeySet(DEFAULT_CONFIG, config);
      // Initialize sql.js storage asynchronously and merge persisted auth accounts when ready
      try {
        SqlStorage.init(authDbPath)
          .then((authAccounts) => {
            try {
              if (authAccounts && Object.keys(authAccounts).length > 0) {
                config.authenticationDatabase = authAccounts
                exports.save();
                logger.info('Merged auth accounts from sql.js storage')
              }
            } catch (e) {
              logger.warn('Failed to merge auth accounts from sql storage', e && e.message)
            }
          })
          .catch((e) => {
            logger.warn('SqlStorage init failed', e && e.message)
          })
      } catch (e) {
        logger.warn('SqlStorage init/merge failed', e && e.message)
      }
      // Save initial config immediately; will be updated if sql storage provides accounts
      exports.save();
    }
  }
  logger.info("Successfully Loaded");
};

/**
 * @returns {boolean} Whether or not the manager has been loaded.
 */
exports.isLoaded = function () {
  return config != null;
};

/**
 * Validate that the destination object has at least every field
 * present in the source object. Assign a default value otherwise.
 *
 * @param {Object} srcObj The source object to reference against.
 * @param {Object} destObj The destination object.
 * @returns {Object} A validated destination object.
 */
function validateKeySet(srcObj, destObj) {
  if (srcObj == null) {
    srcObj = {};
  }
  const validationBlacklist = ["authenticationDatabase", "javaConfig"];
  const keys = Object.keys(srcObj);
  for (let i = 0; i < keys.length; i++) {
    if (typeof destObj[keys[i]] === "undefined") {
      destObj[keys[i]] = srcObj[keys[i]];
    } else if (
      typeof srcObj[keys[i]] === "object" &&
      srcObj[keys[i]] != null &&
      !(srcObj[keys[i]] instanceof Array) &&
      validationBlacklist.indexOf(keys[i]) === -1
    ) {
      destObj[keys[i]] = validateKeySet(srcObj[keys[i]], destObj[keys[i]]);
    }
  }
  return destObj;
}

/**
 * Check to see if this is the first time the user has launched the
 * application. This is determined by the existance of the data path.
 *
 * @returns {boolean} True if this is the first launch, otherwise false.
 */
exports.isFirstLaunch = function () {
  return firstLaunch;
};

/**
 * Returns the name of the folder in the OS temp directory which we
 * will use to extract and store native dependencies for game launch.
 *
 * @returns {string} The name of the folder.
 */
exports.getTempNativeFolder = function () {
  return "WCNatives";
};

// System Settings (Unconfigurable on UI)

/**
 * Retrieve the news cache to determine
 * whether or not there is newer news.
 *
 * @returns {Object} The news cache object.
 */
exports.getNewsCache = function () {
  return config.newsCache;
};

/**
 * Set the new news cache object.
 *
 * @param {Object} newsCache The new news cache object.
 */
exports.setNewsCache = function (newsCache) {
  config.newsCache = newsCache;
};

/**
 * Set whether or not the news has been dismissed (checked)
 *
 * @param {boolean} dismissed Whether or not the news has been dismissed (checked).
 */
exports.setNewsCacheDismissed = function (dismissed) {
  config.newsCache.dismissed = dismissed;
};

/**
 * Retrieve the common directory for shared
 * game files (assets, libraries, etc).
 *
 * @returns {string} The launcher's common directory.
 */
exports.getCommonDirectory = function () {
  return path.join(exports.getDataDirectory(), "common");
};

/**
 * Retrieve the instance directory for the per
 * server game directories.
 *
 * @returns {string} The launcher's instance directory.
 */
exports.getInstanceDirectory = function () {
  return path.join(exports.getDataDirectory(), "instances");
};

/**
 * Retrieve the launcher's Client Token.
 * There is no default client token.
 *
 * @returns {string} The launcher's Client Token.
 */
exports.getClientToken = function () {
  return config.clientToken;
};

/**
 * Set the launcher's Client Token.
 *
 * @param {string} clientToken The launcher's new Client Token.
 */
exports.setClientToken = function (clientToken) {
  config.clientToken = clientToken;
};

/**
 * Retrieve the ID of the selected serverpack.
 *
 * @param {boolean} def Optional. If true, the default value will be returned.
 * @returns {string} The ID of the selected serverpack.
 */
exports.getSelectedServer = function (def = false) {
  return !def ? config.selectedServer : DEFAULT_CONFIG.clientToken;
};

/**
 * Set the ID of the selected serverpack.
 *
 * @param {string} serverID The ID of the new selected serverpack.
 */
exports.setSelectedServer = function (serverID) {
  config.selectedServer = serverID;
};

/**
 * Get an array of each account currently authenticated by the launcher.
 *
 * @returns {Array.<Object>} An array of each stored authenticated account.
 */
exports.getAuthAccounts = function () {
  return config.authenticationDatabase;
};

/**
 * Returns the authenticated account with the given uuid. Value may
 * be null.
 *
 * @param {string} uuid The uuid of the authenticated account.
 * @returns {Object} The authenticated account with the given uuid.
 */
exports.getAuthAccount = function (uuid) {
  return config.authenticationDatabase[uuid];
};

/**
 * Update the access token of an authenticated mojang account.
 *
 * @param {string} uuid The uuid of the authenticated account.
 * @param {string} accessToken The new Access Token.
 *
 * @returns {Object} The authenticated account object created by this action.
 */
exports.updateMojangAuthAccount = function (uuid, accessToken) {
  config.authenticationDatabase[uuid].accessToken = accessToken;
  config.authenticationDatabase[uuid].type = "mojang"; // For gradual conversion.
  return config.authenticationDatabase[uuid];
};

/**
 * Adds an authenticated mojang account to the database to be stored.
 *
 * @param {string} uuid The uuid of the authenticated account.
 * @param {string} accessToken The accessToken of the authenticated account.
 * @param {string} username The username (usually email) of the authenticated account.
 * @param {string} displayName The in game name of the authenticated account.
 *
 * @returns {Object} The authenticated account object created by this action.
 */
exports.addMojangAuthAccount = function (
  uuid,
  accessToken,
  username,
  displayName
) {
  config.selectedAccount = uuid;
  config.authenticationDatabase[uuid] = {
    type: "mojang",
    accessToken,
    username: username.trim(),
    uuid: uuid.trim(),
    displayName: displayName.trim(),
  };
  return config.authenticationDatabase[uuid];
};

/**
 * Update the tokens of an authenticated microsoft account.
 * Includes validation to prevent corrupting account data with invalid values.
 *
 * @param {string} uuid The uuid of the authenticated account.
 * @param {string} accessToken The new Access Token.
 * @param {string} msAccessToken The new Microsoft Access Token
 * @param {string} msRefreshToken The new Microsoft Refresh Token
 * @param {date} msExpires The date when the microsoft access token expires
 * @param {date} mcExpires The date when the mojang access token expires
 *
 * @returns {Object} The authenticated account object created by this action.
 */
exports.updateMicrosoftAuthAccount = function (
  uuid,
  accessToken,
  msAccessToken,
  msRefreshToken,
  msExpires,
  mcExpires
) {
  // Validate inputs to prevent corrupting account data
  if (!uuid || !config.authenticationDatabase[uuid]) {
    logger.warn('Cannot update non-existent account:', uuid);
    return null;
  }
  
  const account = config.authenticationDatabase[uuid];
  
  // Only update fields if they have valid values
  if (accessToken && typeof accessToken === 'string' && accessToken.trim()) {
    account.accessToken = accessToken;
  }
  
  if (mcExpires && typeof mcExpires === 'number' && mcExpires > Date.now()) {
    account.expiresAt = mcExpires;
  }
  
  // Ensure microsoft object exists
  if (!account.microsoft) {
    account.microsoft = {};
  }
  
  if (msAccessToken && typeof msAccessToken === 'string' && msAccessToken.trim()) {
    account.microsoft.access_token = msAccessToken;
  }
  
  // Always preserve refresh token if new one is provided
  if (msRefreshToken && typeof msRefreshToken === 'string' && msRefreshToken.trim()) {
    account.microsoft.refresh_token = msRefreshToken;
  }
  
  if (msExpires && typeof msExpires === 'number' && msExpires > Date.now()) {
    account.microsoft.expires_at = msExpires;
  }
  
  // Add last updated timestamp
  account.lastUpdated = Date.now();
  
  return account;
};

/**
 * Adds an authenticated microsoft account to the database to be stored.
 * Validates all required fields before storing.
 *
 * @param {string} uuid The uuid of the authenticated account.
 * @param {string} accessToken The accessToken of the authenticated account.
 * @param {string} name The in game name of the authenticated account.
 * @param {date} mcExpires The date when the mojang access token expires
 * @param {string} msAccessToken The microsoft access token
 * @param {string} msRefreshToken The microsoft refresh token
 * @param {date} msExpires The date when the microsoft access token expires
 *
 * @returns {Object} The authenticated account object created by this action, or null if validation fails.
 */
exports.addMicrosoftAuthAccount = function (
  uuid,
  accessToken,
  name,
  mcExpires,
  msAccessToken,
  msRefreshToken,
  msExpires
) {
  // Validate required fields
  if (!uuid || typeof uuid !== 'string' || !uuid.trim()) {
    logger.error('Cannot add Microsoft account: invalid UUID');
    return null;
  }
  
  if (!accessToken || typeof accessToken !== 'string' || !accessToken.trim()) {
    logger.error('Cannot add Microsoft account: invalid access token');
    return null;
  }
  
  if (!msRefreshToken || typeof msRefreshToken !== 'string' || !msRefreshToken.trim()) {
    logger.error('Cannot add Microsoft account: invalid refresh token');
    return null;
  }
  
  const trimmedUuid = uuid.trim();
  const trimmedName = (name || 'Unknown Player').trim();
  
  // Create account object with all required fields
  const accountData = {
    type: "microsoft",
    accessToken: accessToken,
    username: trimmedName,
    uuid: trimmedUuid,
    displayName: trimmedName,
    expiresAt: mcExpires || (Date.now() + 86400000), // Default 24h if not provided
    createdAt: Date.now(),
    lastUpdated: Date.now(),
    microsoft: {
      access_token: msAccessToken || accessToken,
      refresh_token: msRefreshToken,
      expires_at: msExpires || (Date.now() + 3600000), // Default 1h if not provided
    },
  };
  
  config.selectedAccount = trimmedUuid;
  config.authenticationDatabase[trimmedUuid] = accountData;
  
  logger.info('Added Microsoft account:', trimmedName, '(' + trimmedUuid + ')');
  
  return accountData;
};

/**
 * Remove an authenticated account from the database. If the account
 * was also the selected account, a new one will be selected. If there
 * are no accounts, the selected account will be null.
 *
 * @param {string} uuid The uuid of the authenticated account.
 *
 * @returns {boolean} True if the account was removed, false if it never existed.
 */
exports.removeAuthAccount = function (uuid) {
  if (!uuid) {
    logger.warn('Cannot remove account: no UUID provided');
    return false;
  }
  
  if (config.authenticationDatabase[uuid] != null) {
    const accountName = config.authenticationDatabase[uuid].displayName || uuid;
    
    // Remove from memory
    delete config.authenticationDatabase[uuid];
    
    // Also remove from SQL storage directly for immediate effect
    try {
      if (SqlStorage && typeof SqlStorage.removeAuthAccount === 'function') {
        SqlStorage.removeAuthAccount(uuid);
      }
    } catch (e) {
      logger.debug('SqlStorage.removeAuthAccount not available');
    }
    
    // Select a new account if needed
    if (config.selectedAccount === uuid) {
      const keys = Object.keys(config.authenticationDatabase);
      if (keys.length > 0) {
        // Select the most recently updated account
        let newestKey = keys[0];
        let newestTime = 0;
        for (const key of keys) {
          const acc = config.authenticationDatabase[key];
          if (acc.lastUpdated && acc.lastUpdated > newestTime) {
            newestTime = acc.lastUpdated;
            newestKey = key;
          }
        }
        config.selectedAccount = newestKey;
        logger.info('Selected new account after removal:', config.authenticationDatabase[newestKey]?.displayName);
      } else {
        config.selectedAccount = null;
        config.clientToken = null;
        logger.info('No accounts remaining after removal');
      }
    }
    
    logger.info('Removed account:', accountName);
    return true;
  }
  
  logger.debug('Account not found for removal:', uuid);
  return false;
};

/**
 * Check if an account exists in the database
 * 
 * @param {string} uuid The uuid to check
 * @returns {boolean} True if the account exists
 */
exports.hasAuthAccount = function(uuid) {
  return uuid && config.authenticationDatabase[uuid] != null;
};

/**
 * Get the count of authenticated accounts
 * 
 * @returns {number} The number of accounts
 */
exports.getAuthAccountCount = function() {
  return Object.keys(config.authenticationDatabase || {}).length;
};

/**
 * Get the currently selected authenticated account.
 *
 * @returns {Object} The selected authenticated account.
 */
exports.getSelectedAccount = function () {
  return config.authenticationDatabase[config.selectedAccount];
};

/**
 * Set the selected authenticated account.
 *
 * @param {string} uuid The UUID of the account which is to be set
 * as the selected account.
 *
 * @returns {Object} The selected authenticated account.
 */
exports.setSelectedAccount = function (uuid) {
  const authAcc = config.authenticationDatabase[uuid];
  if (authAcc != null) {
    config.selectedAccount = uuid;
  }
  return authAcc;
};

/**
 * Get an array of each mod configuration currently stored.
 *
 * @returns {Array.<Object>} An array of each stored mod configuration.
 */
exports.getModConfigurations = function () {
  return config.modConfigurations;
};

/**
 * Set the array of stored mod configurations.
 *
 * @param {Array.<Object>} configurations An array of mod configurations.
 */
exports.setModConfigurations = function (configurations) {
  config.modConfigurations = configurations;
};

/**
 * Get the mod configuration for a specific server.
 *
 * @param {string} serverid The id of the server.
 * @returns {Object} The mod configuration for the given server.
 */
exports.getModConfiguration = function (serverid) {
  const cfgs = config.modConfigurations;
  for (let i = 0; i < cfgs.length; i++) {
    if (cfgs[i].id === serverid) {
      return cfgs[i];
    }
  }
  return null;
};

/**
 * Set the mod configuration for a specific server. This overrides any existing value.
 *
 * @param {string} serverid The id of the server for the given mod configuration.
 * @param {Object} configuration The mod configuration for the given server.
 */
exports.setModConfiguration = function (serverid, configuration) {
  const cfgs = config.modConfigurations;
  for (let i = 0; i < cfgs.length; i++) {
    if (cfgs[i].id === serverid) {
      cfgs[i] = configuration;
      return;
    }
  }
  cfgs.push(configuration);
};

// User Configurable Settings

// Java Settings

function defaultJavaConfig(effectiveJavaOptions, ram) {
  if (effectiveJavaOptions.suggestedMajor > 8) {
    return defaultJavaConfig17(ram);
  } else {
    return defaultJavaConfig8(ram);
  }
}

function defaultJavaConfig8(ram) {
  return {
    minRAM: resolveSelectedRAM(ram),
    maxRAM: resolveSelectedRAM(ram),
    executable: null,
    jvmOptions: [
      "-XX:+UseConcMarkSweepGC",
      "-XX:+CMSIncrementalMode",
      "-XX:-UseAdaptiveSizePolicy",
      "-Xmn128M",
    ],
  };
}

function defaultJavaConfig17(ram) {
  return {
    minRAM: resolveSelectedRAM(ram),
    maxRAM: resolveSelectedRAM(ram),
    executable: null,
    jvmOptions: [
      "-XX:+UnlockExperimentalVMOptions",
      "-XX:+UseG1GC",
      "-XX:G1NewSizePercent=20",
      "-XX:G1ReservePercent=20",
      "-XX:MaxGCPauseMillis=50",
      "-XX:G1HeapRegionSize=32M",
    ],
  };
}

/**
 * Ensure a java config property is set for the given server.
 *
 * @param {string} serverid The server id.
 * @param {*} mcVersion The minecraft version of the server.
 */
exports.ensureJavaConfig = function (serverid, effectiveJavaOptions, ram) {
  if (!Object.prototype.hasOwnProperty.call(config.javaConfig, serverid)) {
    config.javaConfig[serverid] = defaultJavaConfig(effectiveJavaOptions, ram);
  }
};

/**
 * Retrieve the minimum amount of memory for JVM initialization. This value
 * contains the units of memory. For example, '5G' = 5 GigaBytes, '1024M' =
 * 1024 MegaBytes, etc.
 *
 * @param {string} serverid The server id.
 * @returns {string} The minimum amount of memory for JVM initialization.
 */
exports.getMinRAM = function (serverid) {
  return config.javaConfig[serverid].minRAM;
};

/**
 * Set the minimum amount of memory for JVM initialization. This value should
 * contain the units of memory. For example, '5G' = 5 GigaBytes, '1024M' =
 * 1024 MegaBytes, etc.
 *
 * @param {string} serverid The server id.
 * @param {string} minRAM The new minimum amount of memory for JVM initialization.
 */
exports.setMinRAM = function (serverid, minRAM) {
  config.javaConfig[serverid].minRAM = minRAM;
};

/**
 * Retrieve the maximum amount of memory for JVM initialization. This value
 * contains the units of memory. For example, '5G' = 5 GigaBytes, '1024M' =
 * 1024 MegaBytes, etc.
 *
 * @param {string} serverid The server id.
 * @returns {string} The maximum amount of memory for JVM initialization.
 */
exports.getMaxRAM = function (serverid) {
  return config.javaConfig[serverid].maxRAM;
};

/**
 * Set the maximum amount of memory for JVM initialization. This value should
 * contain the units of memory. For example, '5G' = 5 GigaBytes, '1024M' =
 * 1024 MegaBytes, etc.
 *
 * @param {string} serverid The server id.
 * @param {string} maxRAM The new maximum amount of memory for JVM initialization.
 */
exports.setMaxRAM = function (serverid, maxRAM) {
  config.javaConfig[serverid].maxRAM = maxRAM;
};

/**
 * Retrieve the path of the Java Executable.
 *
 * This is a resolved configuration value and defaults to null until externally assigned.
 *
 * @param {string} serverid The server id.
 * @returns {string} The path of the Java Executable.
 */
exports.getJavaExecutable = function (serverid) {
  return config.javaConfig[serverid].executable;
};

/**
 * Set the path of the Java Executable.
 *
 * @param {string} serverid The server id.
 * @param {string} executable The new path of the Java Executable.
 */
exports.setJavaExecutable = function (serverid, executable) {
  config.javaConfig[serverid].executable = executable;
};

/**
 * Retrieve the additional arguments for JVM initialization. Required arguments,
 * such as memory allocation, will be dynamically resolved and will not be included
 * in this value.
 *
 * @param {string} serverid The server id.
 * @returns {Array.<string>} An array of the additional arguments for JVM initialization.
 */
exports.getJVMOptions = function (serverid) {
  return config.javaConfig[serverid].jvmOptions;
};

/**
 * Set the additional arguments for JVM initialization. Required arguments,
 * such as memory allocation, will be dynamically resolved and should not be
 * included in this value.
 *
 * @param {string} serverid The server id.
 * @param {Array.<string>} jvmOptions An array of the new additional arguments for JVM
 * initialization.
 */
exports.setJVMOptions = function (serverid, jvmOptions) {
  config.javaConfig[serverid].jvmOptions = jvmOptions;
};

// Game Settings

/**
 * Retrieve the width of the game window.
 *
 * @param {boolean} def Optional. If true, the default value will be returned.
 * @returns {number} The width of the game window.
 */
exports.getGameWidth = function (def = false) {
  return !def
    ? config.settings.game.resWidth
    : DEFAULT_CONFIG.settings.game.resWidth;
};

/**
 * Set the width of the game window.
 *
 * @param {number} resWidth The new width of the game window.
 */
exports.setGameWidth = function (resWidth) {
  config.settings.game.resWidth = Number.parseInt(resWidth);
};

/**
 * Validate a potential new width value.
 *
 * @param {number} resWidth The width value to validate.
 * @returns {boolean} Whether or not the value is valid.
 */
exports.validateGameWidth = function (resWidth) {
  const nVal = Number.parseInt(resWidth);
  return Number.isInteger(nVal) && nVal >= 0;
};

/**
 * Retrieve the height of the game window.
 *
 * @param {boolean} def Optional. If true, the default value will be returned.
 * @returns {number} The height of the game window.
 */
exports.getGameHeight = function (def = false) {
  return !def
    ? config.settings.game.resHeight
    : DEFAULT_CONFIG.settings.game.resHeight;
};

/**
 * Set the height of the game window.
 *
 * @param {number} resHeight The new height of the game window.
 */
exports.setGameHeight = function (resHeight) {
  config.settings.game.resHeight = Number.parseInt(resHeight);
};

/**
 * Validate a potential new height value.
 *
 * @param {number} resHeight The height value to validate.
 * @returns {boolean} Whether or not the value is valid.
 */
exports.validateGameHeight = function (resHeight) {
  const nVal = Number.parseInt(resHeight);
  return Number.isInteger(nVal) && nVal >= 0;
};

/**
 * Check if the game should be launched in fullscreen mode.
 *
 * @param {boolean} def Optional. If true, the default value will be returned.
 * @returns {boolean} Whether or not the game is set to launch in fullscreen mode.
 */
exports.getFullscreen = function (def = false) {
  return !def
    ? config.settings.game.fullscreen
    : DEFAULT_CONFIG.settings.game.fullscreen;
};

/**
 * Change the status of if the game should be launched in fullscreen mode.
 *
 * @param {boolean} fullscreen Whether or not the game should launch in fullscreen mode.
 */
exports.setFullscreen = function (fullscreen) {
  config.settings.game.fullscreen = fullscreen;
};

/**
 * Check if the game should auto connect to servers.
 *
 * @param {boolean} def Optional. If true, the default value will be returned.
 * @returns {boolean} Whether or not the game should auto connect to servers.
 */
exports.getAutoConnect = function (def = false) {
  return !def
    ? config.settings.game.autoConnect
    : DEFAULT_CONFIG.settings.game.autoConnect;
};

/**
 * Change the status of whether or not the game should auto connect to servers.
 *
 * @param {boolean} autoConnect Whether or not the game should auto connect to servers.
 */
exports.setAutoConnect = function (autoConnect) {
  config.settings.game.autoConnect = autoConnect;
};

/**
 * Check if the game should launch as a detached process.
 *
 * @param {boolean} def Optional. If true, the default value will be returned.
 * @returns {boolean} Whether or not the game will launch as a detached process.
 */
exports.getLaunchDetached = function (def = false) {
  return !def
    ? config.settings.game.launchDetached
    : DEFAULT_CONFIG.settings.game.launchDetached;
};

/**
 * Change the status of whether or not the game should launch as a detached process.
 *
 * @param {boolean} launchDetached Whether or not the game should launch as a detached process.
 */
exports.setLaunchDetached = function (launchDetached) {
  config.settings.game.launchDetached = launchDetached;
};

/**
 * Get whether Minecraft logs should be displayed in the launcher UI.
 *
 * @param {boolean} def Optional. If true, return the default value.
 * @returns {boolean}
 */
exports.getShowMinecraftLogs = function (def = false) {
  return !def
    ? config.settings.game.showMinecraftLogs
    : DEFAULT_CONFIG.settings.game.showMinecraftLogs;
};

/**
 * Set whether Minecraft logs should be displayed in the launcher UI.
 *
 * @param {boolean} val
 */
exports.setShowMinecraftLogs = function (val) {
  config.settings.game.showMinecraftLogs = !!val;
};

// Launcher Settings

/**
 * Check if the launcher should download prerelease versions.
 *
 * @param {boolean} def Optional. If true, the default value will be returned.
 * @returns {boolean} Whether or not the launcher should download prerelease versions.
 */
exports.getAllowPrerelease = function (def = false) {
  return !def
    ? config.settings.launcher.allowPrerelease
    : DEFAULT_CONFIG.settings.launcher.allowPrerelease;
};

/**
 * Change the status of Whether or not the launcher should download prerelease versions.
 *
 * @param {boolean} launchDetached Whether or not the launcher should download prerelease versions.
 */
exports.setAllowPrerelease = function (allowPrerelease) {
  config.settings.launcher.allowPrerelease = allowPrerelease;
};

// Resource Pack Settings

/**
 * Get the resource pack settings.
 *
 * @param {boolean} def Optional. If true, the default value will be returned.
 * @returns {Object} The resource pack settings object.
 */
exports.getResourcePackSettings = function (def = false) {
  if (!def && config.settings.launcher.resourcePackSettings) {
    return config.settings.launcher.resourcePackSettings;
  }
  
  const defaultSettings = {
    autoFixEnabled: true,
    notificationsEnabled: true,
    lastErrorCheck: null
  };
  
  return defaultSettings;
};

/**
 * Set the resource pack settings.
 *
 * @param {Object} settings The resource pack settings object.
 */
exports.setResourcePackSettings = function (settings) {
  if (!config.settings.launcher.resourcePackSettings) {
    config.settings.launcher.resourcePackSettings = {};
  }
  config.settings.launcher.resourcePackSettings = { ...config.settings.launcher.resourcePackSettings, ...settings };
};

/**
 * Check if auto-fix for resource packs is enabled.
 *
 * @returns {boolean} Whether auto-fix is enabled.
 */
exports.getResourcePackAutoFix = function () {
  const settings = this.getResourcePackSettings();
  return settings.autoFixEnabled;
};

/**
 * Set the auto-fix status for resource packs.
 *
 * @param {boolean} enabled Whether auto-fix should be enabled.
 */
exports.setResourcePackAutoFix = function (enabled) {
  const settings = this.getResourcePackSettings();
  settings.autoFixEnabled = enabled;
  this.setResourcePackSettings(settings);
};

/**
 * Check if resource pack error notifications are enabled.
 *
 * @returns {boolean} Whether notifications are enabled.
 */
exports.getResourcePackNotifications = function () {
  const settings = this.getResourcePackSettings();
  return settings.notificationsEnabled;
};

/**
 * Set the notification status for resource pack errors.
 *
 * @param {boolean} enabled Whether notifications should be enabled.
 */
exports.setResourcePackNotifications = function (enabled) {
  const settings = this.getResourcePackSettings();
  settings.notificationsEnabled = enabled;
  this.setResourcePackSettings(settings);
};
