Installer wrapper scripts
=========================

Purpose
-------
These small helper scripts let you run a normal installer and automatically restart the launcher once the installer process finishes. Useful when you run an installer manually (not via the auto-update flow).

Files
-----
- `run-installer-and-restart.ps1` — Windows PowerShell wrapper.
- `run-installer-and-restart.sh` — Unix shell wrapper.

Usage examples
--------------

Windows (PowerShell):

1. Open PowerShell as needed.
2. Run:

```powershell
.	ools\run-installer-and-restart.ps1 "C:\path\to\setup.exe" "C:\Program Files\MultiGames Studio Launcher\MultiGames Studio Launcher.exe"
```

If you omit the second argument the script will only run the installer and will not attempt to restart the launcher.

Unix (Linux/macOS):

```sh
sh ./tools/run-installer-and-restart.sh /path/to/setup.sh /path/to/launcher
```

Notes
-----
- The wrapper tries to wait for the installer process (by PID). If the installer is a stub that spawns children then exits quickly, the wrapper falls back to polling processes by the installer's basename.
- The wrapper attempts to self-delete after finishing.
- These wrappers are simple helpers — they assume the provided launcher path is correct and runnable. If the installer performs elevation (UAC) you may need to run the wrapper with appropriate privileges.

If you want, I can also:
- Add a small GUI script that prompts for the installer file and runs the wrapper.
- Integrate a helper into the packaged installer so it calls the launcher directly on finish.
