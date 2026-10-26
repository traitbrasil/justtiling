// SPDX-License-Identifier: GPL-3.0-or-later
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import {framebufferMapping, cornerPaintVolume} from './cornerGeometry.js';

import {CornerBackend} from './cornerBackend.js';

export const CornerEffect = GObject.registerClass(
class JustTilingCornerEffect extends CornerBackend {
    update(geometry) {
        this.bounds = geometry.bounds;
        this.pixelScale = geometry.scale ?? 1;
        this.get_actor()?.invalidate_paint_volume();
        this.uniform('jtFrame', 4, geometry.bounds);
        this.uniform('jtRadius', 1, [geometry.radius]);
        this.uniform('jtPixelScale', 1, [this.pixelScale]);
        this.uniform('jtFocusBorderWidth', 1, [geometry.focusBorderWidth ?? 0]);
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
                    this.uniform('jtFramebuffer', 4, mapping);
                    this.uniform('jtOpacity', 1, [actor.get_paint_opacity() / 255]);
                    enabled = true;
                }
            }
            this.warned = false;
        } catch (error) {
            if (!this.warned) console.warn(`[justtiling] Corner mapping: ${error}`);
            this.warned = true;
        }
        // Missing/invalid framebuffer data must leave the original image visible.
        this.uniform('jtMaskEnabled', 1, [enabled ? 1 : 0]);
        super.vfunc_paint_target(node, context);
    }
});
