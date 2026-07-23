// -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*-
// vim: filetype=javascript ts=4 sw=4 expandtab

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

// ============================================================================
// Configuration
// ============================================================================

const BINDINGS = {
    TILE_LEFT: '<Super>h',
    TILE_RIGHT: '<Super>l',
    TILE_UP: '<Super>k',
    TILE_DOWN: '<Super>j',
    FLOAT_TOGGLE: '<Super>space',
    FULLSCREEN: '<Super>f',
    RESIZE_LEFT: '<Control><Super>Left',
    RESIZE_RIGHT: '<Control><Super>Right',
};

const IGNORED_WM_CLASSES = [
    'Firefox',
    'Chromium',
    'gnome-initial-setup',
    'login-window',
];

// ============================================================================
// Main Extension Class
// ============================================================================

export default class SimpleTilingExtension extends Extension {
    
    // ------------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------------
    
    enable() {
        log('[TilingExtension] Enabling...');
        
        this._display = global.display;
        this._workspaceManager = global.workspace_manager;
        this._settings = this.getSettings();
        
        // Tiling state tracking
        this._tilingState = new Map();
        
        // Connect signals
        this._signalIds = [];
        this._signalIds.push(
            this._display.connect('window-created', this._onWindowCreated.bind(this)),
            this._display.connect('grab-begins', this._onGrabBegin.bind(this))
        );
        
        // Setup initial windows
        this._setupInitialWindows();
        
        // Register keybindings
        this._registerKeybindings();
        
        log('[TilingExtension] Enabled successfully');
    }
    
    disable() {
        log('[TilingExtension] Disabling...');
        
        // Disconnect signals
        for (const id of this._signalIds) {
            this._display.disconnect(id);
        }
        this._signalIds = [];
        
        // Remove keybindings
        this._unregisterKeybindings();
        
        // Reset tiling state
        this._resetAllWindows();
        this._tilingState.clear();
        
        log('[TilingExtension] Disabled');
    }
    
    // ------------------------------------------------------------------------
    // Keybindings
    // ------------------------------------------------------------------------
    
    _registerKeybindings() {
        const scheme = new Gio.Settings({ schema_id: 'org.gnome.desktop.wm.keybindings' });
        
        const bindings = [
            ['tile-left', BINDINGS.TILE_LEFT, this._tileLeft.bind(this)],
            ['tile-right', BINDINGS.TILE_RIGHT, this._tileRight.bind(this)],
            ['tile-up', BINDINGS.TILE_UP, this._tileUp.bind(this)],
            ['tile-down', BINDINGS.TILE_DOWN, this._tileDown.bind(this)],
            ['float-toggle', BINDINGS.FLOAT_TOGGLE, this._toggleFloat.bind(this)],
            ['fullscreen', BINDINGS.FULLSCREEN, this._toggleFullscreen.bind(this)],
        ];
        
        for (const [name, shortcut, callback] of bindings) {
            const keyName = `extension-${name}`;
            
            try {
                this._addKeybinding(keyName, shortcut, callback);
            } catch (e) {
                log(`[TilingExtension] Failed to register ${keyName}: ${e.message}`);
            }
        }
        
        this._registeredBindings = bindings.map(b => b[0]);
    }
    
    _addKeybinding(name, shortcut, callback) {
        this._settings.set_strv(name, [shortcut]);
        
        Main.wm.addKeybinding(
            name,
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL,
            callback
        );
    }
    
    _unregisterKeybindings() {
        if (!this._registeredBindings) return;
        
        for (const name of this._registeredBindings) {
            try {
                Main.wm.removeKeybinding(name);
            } catch (e) {
                log(`[TilingExtension] Warning removing ${name}: ${e.message}`);
            }
        }
        
        this._registeredBindings = [];
    }
    
    // ------------------------------------------------------------------------
    // Window Management
    // ------------------------------------------------------------------------
    
    _setupInitialWindows() {
        const workspace = this._workspaceManager.get_active_workspace();
        for (const window of workspace.list_windows()) {
            if (!this._shouldIgnoreWindow(window)) {
                this._configureWindow(window);
            }
        }
    }
    
    _onWindowCreated(display, metaWindow) {
        this._configureWindow(metaWindow);
    }
    
    _configureWindow(window) {
        if (this._shouldIgnoreWindow(window)) {
            return;
        }
        
        // Track destroy signal
        const destroyId = window.connect('destroy', () => {
            this._tilingState.delete(window);
        });
        
        // Store tracking info
        this._tilingState.set(window, {
            tiled: false,
            destroyId,
            frameRectBeforeTile: null
        });
    }
    
    _shouldIgnoreWindow(window) {
        if (!window) return true;
        if (window.get_transient_for() !== null) return true;
        if (window.is_on_all_workspaces()) return true;
        if (window.get_wm_class() === null) return true;
        
        // Check ignored WM classes
        const wmClass = window.get_wm_class();
        for (const ignored of IGNORED_WM_CLASSES) {
            if (wmClass.includes(ignored)) {
                return true;
            }
        }
        
        return false;
    }
    
    _resetAllWindows() {
        for (const [window, state] of this._tilingState) {
            if (state.destroyId) {
                window.disconnect(state.destroyId);
            }
            
            if (state.tiled) {
                window.unmaximize(Meta.MaximizeFlags.HORIZONTAL);
                window.unmaximize(Meta.MaximizeFlags.VERTICAL);
            }
        }
    }
    
    // ------------------------------------------------------------------------
    // Tiling Logic
    // ------------------------------------------------------------------------
    
    _getFocusedWindow() {
        return this._display.focus_window;
    }
    
    _getWorkspaceWindows(workspace = null) {
        if (!workspace) {
            workspace = this._workspaceManager.get_active_workspace();
        }
        return workspace.list_windows().filter(w => !w.minimized && !this._shouldIgnoreWindow(w));
    }
    
    _getMonitorGeometry(monitorIndex = -1) {
        if (monitorIndex === -1) {
            monitorIndex = this._display.get_current_monitor();
        }
        return this._display.get_monitor_geometry(monitorIndex);
    }
    
    _tileLeft() {
        const focus = this._getFocusedWindow();
        if (!focus || !focus.can_focus()) return;
        
        const windows = this._getWorkspaceWindows();
        const index = windows.indexOf(focus);
        
        if (index > 0) {
            this._tileWithDirection(focus, windows[index - 1], 'left');
        } else {
            this._showNotification('No window to the left');
        }
    }
    
    _tileRight() {
        const focus = this._getFocusedWindow();
        if (!focus || !focus.can_focus()) return;
        
        const windows = this._getWorkspaceWindows();
        const index = windows.indexOf(focus);
        
        if (index < windows.length - 1) {
            this._tileWithDirection(focus, windows[index + 1], 'right');
        } else {
            this._showNotification('No window to the right');
        }
    }
    
    _tileUp() {
        const focus = this._getFocusedWindow();
        if (!focus || !focus.can_focus()) return;
        
        const windows = this._getWorkspaceWindows();
        const index = windows.indexOf(focus);
        
        if (index > 0) {
            this._tileWithDirection(focus, windows[index - 1], 'up');
        }
    }
    
    _tileDown() {
        const focus = this._getFocusedWindow();
        if (!focus || !focus.can_focus()) return;
        
        const windows = this._getWorkspaceWindows();
        const index = windows.indexOf(focus);
        
        if (index < windows.length - 1) {
            this._tileWithDirection(focus, windows[index + 1], 'down');
        }
    }
    
    _tileWithDirection(win1, win2, direction) {
        if (!win1 || !win2) return;
        
        const monitor = this._getMonitorGeometry();
        
        switch (direction) {
            case 'left':
            case 'right':
                this._tileHorizontally(win1, win2, monitor);
                break;
            case 'up':
            case 'down':
                this._tileVertically(win1, win2, monitor);
                break;
        }
    }
    
    _tileHorizontally(win1, win2, monitor) {
        const width = Math.floor(monitor.width / 2);
        
        // Left window
        win1.move_frame(true,
            monitor.x,
            monitor.y,
            width,
            monitor.height
        );
        win1.maximize(Meta.MaximizeFlags.VERTICAL);
        
        // Right window
        win2.move_frame(true,
            monitor.x + width,
            monitor.y,
            width,
            monitor.height
        );
        win2.maximize(Meta.MaximizeFlags.VERTICAL);
        
        this._updateTilingState(win1, true);
        this._updateTilingState(win2, true);
    }
    
    _tileVertically(win1, win2, monitor) {
        const height = Math.floor(monitor.height / 2);
        
        // Top window
        win1.move_frame(true,
            monitor.x,
            monitor.y,
            monitor.width,
            height
        );
        win1.maximize(Meta.MaximizeFlags.HORIZONTAL);
        
        // Bottom window
        win2.move_frame(true,
            monitor.x,
            monitor.y + height,
            monitor.width,
            height
        );
        win2.maximize(Meta.MaximizeFlags.HORIZONTAL);
        
        this._updateTilingState(win1, true);
        this._updateTilingState(win2, true);
    }
    
    _updateTilingState(window, tiled) {
        if (!this._tilingState.has(window)) {
            this._configureWindow(window);
        }
        
        const state = this._tilingState.get(window);
        state.tiled = tiled;
    }
    
    // ------------------------------------------------------------------------
    // Float & Fullscreen
    // ------------------------------------------------------------------------
    
    _toggleFloat() {
        const focus = this._getFocusedWindow();
        if (!focus) return;
        
        const state = this._tilingState.get(focus);
        
        if (state && state.tiled) {
            focus.unmaximize(Meta.MaximizeFlags.HORIZONTAL);
            focus.unmaximize(Meta.MaximizeFlags.VERTICAL);
            this._updateTilingState(focus, false);
            this._showNotification('Floating Mode');
        } else {
            focus.maximize(Meta.MaximizeFlags.BOTH);
            this._updateTilingState(focus, true);
            this._showNotification('Maximized');
        }
    }
    
    _toggleFullscreen() {
        const focus = this._getFocusedWindow();
        if (!focus) return;
        
        if (focus.fullscreen) {
            focus.make_above(false);
            focus.set_fullscreen(false);
        } else {
            focus.make_above(true);
            focus.set_fullscreen(true);
        }
    }
    
    _onGrabBegin(display, actor, grabOp) {
        // Handle drag operations - could add resize logic here later
    }
    
    // ------------------------------------------------------------------------
    // Utilities
    // ------------------------------------------------------------------------
    
    _showNotification(text) {
        // Simple notification - can be enhanced with custom indicator
        log(`[TilingExtension] ${text}`);
    }
}

// Export for backward compatibility
var Extension = SimpleTilingExtension;
