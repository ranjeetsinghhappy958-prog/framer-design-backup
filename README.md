# Framer Design Backup V6.1 HTTPS Fix

This version restores the HTTPS development-server setup used by the earlier working plugin.

## Windows
1. Extract the ZIP to a new folder.
2. Double-click `START-FRESH-WINDOWS.bat`.
3. Keep the CMD window open.
4. In Framer: Plugins > Open Development Plugin.

Expected local URL starts with `https://localhost:5173/` (not http).

The first run may ask Windows to trust/install a local development certificate through mkcert. Allow it.
