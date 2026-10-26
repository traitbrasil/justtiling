// SPDX-License-Identifier: GPL-3.0-or-later
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import {CORNER_DECLARATIONS, CORNER_FRAGMENT} from './cornerGeometry.js';

// Shell.GLSLEffect was replaced by Clutter's snippet-based ShaderEffect in 51.
// Register only the vfuncs available on the selected native base class.
export const modernShader = typeof Clutter.ShaderEffect.prototype.set_uniform_float === 'function';
export const CornerBackend = modernShader ? GObject.registerClass(
class JustTilingModernCornerBackend extends Clutter.ShaderEffect {
    vfunc_get_static_snippet() {
        return Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, CORNER_DECLARATIONS, CORNER_FRAGMENT);
    }
    uniform(name, components, values) { this.set_uniform_float(name, components, values); }
}) : GObject.registerClass(
class JustTilingLegacyCornerBackend extends Shell.GLSLEffect {
    vfunc_build_pipeline() {
        this.add_glsl_snippet(Cogl.SnippetHook.FRAGMENT, CORNER_DECLARATIONS, CORNER_FRAGMENT, false);
    }
    uniform(name, components, values) {
        this.set_uniform_float(this.get_uniform_location(name), components, values);
    }
});
