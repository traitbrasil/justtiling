// SPDX-License-Identifier: GPL-3.0-or-later
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import {CORNER_DECLARATIONS, CORNER_FRAGMENT, framebufferMapping, cornerPaintVolume} from './cornerGeometry.js';

export const CornerEffect = GObject.registerClass(
class JustTilingCornerEffect extends Clutter.ShaderEffect {
    vfunc_get_static_snippet() {
        return Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, CORNER_DECLARATIONS, CORNER_FRAGMENT);
    }

    update(geometry) {
        this.bounds = geometry.bounds;
        this.pixelScale = geometry.scale ?? 1;
        this.get_actor()?.invalidate_paint_volume();
        this.set_uniform_float('jtFrame', 4, geometry.bounds);
        this.set_uniform_float('jtRadius', 1, [geometry.radius]);
        this.set_uniform_float('jtPixelScale', 1, [this.pixelScale]);
        this.set_uniform_float('jtFocusBorderWidth', 1, [geometry.focusBorderWidth ?? 0]);
    }

    vfunc_modify_paint_volume(volume) {
        if (this.bounds) {
            const origin = volume.get_origin();
            const expanded = cornerPaintVolume({x: origin.x, y: origin.y,
                width: volume.get_width(), height: volume.get_height()}, this.bounds, this.pixelScale);
            volume.set_origin(new Graphene.Point3D({x: expanded.x, y: expanded.y, z: origin.z}));
            volume.set_width(expanded.width);
            volume.set_height(expanded.height);
        }
        return true;
    }

    vfunc_paint_target(node, context) {
        let enabled = false;
        try {
            const actor = this.get_actor();
            const [known, width, height] = this.get_target_size();
            if (actor && known) {
                const volume = actor.get_paint_volume();
                const origin = volume?.get_origin();
                const mapping = framebufferMapping({x: origin?.x ?? 0, y: origin?.y ?? 0,
                    width: volume?.get_width() ?? actor.width, height: volume?.get_height() ?? actor.height},
                width, height, actor.get_resource_scale());
                if (mapping) {
                    this.set_uniform_float('jtFramebuffer', 4, mapping);
                    this.set_uniform_float('jtOpacity', 1, [actor.get_paint_opacity() / 255]);
                    enabled = true;
                }
            }
            this.warned = false;
        } catch (error) {
            if (!this.warned) console.warn(`[justtiling] Corner mapping: ${error}`);
            this.warned = true;
        }
        // Missing/invalid framebuffer data must leave the original image visible.
        this.set_uniform_float('jtMaskEnabled', 1, [enabled ? 1 : 0]);
        super.vfunc_paint_target(node, context);
    }
});
