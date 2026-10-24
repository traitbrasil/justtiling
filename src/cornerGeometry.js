// SPDX-License-Identifier: GPL-3.0-or-later
// Shared by the visual mask and focus border, in logical pixels.
export const DEFAULT_CORNER_RADIUS = 8;
export function cornerRadius(value = DEFAULT_CORNER_RADIUS) {
    return Number.isFinite(value) ? Math.max(0, Math.min(64, value)) : DEFAULT_CORNER_RADIUS;
}

export function cornerGeometry(visual, radius = DEFAULT_CORNER_RADIUS) {
    const {frame, buffer, width, height} = visual ?? {};
    if (!frame || !buffer || ![frame.x, frame.y, frame.width, frame.height,
        buffer.x, buffer.y, buffer.width, buffer.height, width, height].every(Number.isFinite) ||
        Math.min(frame.width, frame.height, buffer.width, buffer.height, width, height) <= 0) return null;
    const sx = width / buffer.width, sy = height / buffer.height;
    return {bounds: [(frame.x - buffer.x) * sx, (frame.y - buffer.y) * sy,
        frame.width * sx, frame.height * sy],
    scale: Math.min(sx, sy),
    radius: Math.min(cornerRadius(radius) * Math.min(sx, sy), frame.width * sx / 2, frame.height * sy / 2)};
}

// Include the shadow in damage/visibility bounds; the shader also fades it
// before the actual cached texture edge, which can have less space.
export function cornerPaintVolume(volume, bounds, scale = 1) {
    const [x, y, width, height] = bounds;
    const margin = 20 * scale;
    const left = Math.min(volume.x, x - margin), top = Math.min(volume.y, y - margin);
    return {x: left, y: top,
        width: Math.max(volume.x + volume.width, x + width + margin) - left,
        height: Math.max(volume.y + volume.height, y + height + margin) - top};
}

// ClutterOffscreenEffect enlarges the paint volume before allocating its FBO.
// Coordinate mapping adapted from Rounded Window Corners Native (GPL-3.0-or-later),
// Copyright 2026 Ahmet Öztürk: https://github.com/ztrahmet/rounded-window-corners
export function framebufferMapping(volume, targetWidth, targetHeight, resourceScale) {
    if (![volume.x, volume.y, volume.width, volume.height, targetWidth, targetHeight, resourceScale]
        .every(Number.isFinite) || Math.min(targetWidth, targetHeight, resourceScale) <= 0) return null;
    const scale = Math.max(1, Math.ceil(resourceScale));
    const width = targetWidth / scale, height = targetHeight / scale;
    return [Math.ceil(volume.x + volume.width + 0.75) - width,
        Math.ceil(volume.y + volume.height + 0.75) - height, width, height];
}

export const CORNER_DECLARATIONS = `
uniform vec4 jtFrame;
uniform vec4 jtFramebuffer;
uniform float jtRadius;
uniform float jtMaskEnabled;
uniform float jtOpacity;
uniform float jtPixelScale;
uniform float jtFocusBorderWidth;

`;
export const CORNER_FRAGMENT = `
vec2 jtPoint = jtFramebuffer.xy + cogl_tex_coord_in[0].xy * jtFramebuffer.zw;
vec2 jtLocal = jtPoint - jtFrame.xy;
// Apply the mask to the complete frame, including the external margin.
// Keeping the old pixels outside the frame preserves square client outlines.
if (jtMaskEnabled > 0.5) {
    vec2 jtHalf = jtFrame.zw * 0.5;
    vec2 jtQ = abs(jtLocal - jtHalf) - (jtHalf - vec2(jtRadius));
    float jtDistance = length(max(jtQ, vec2(0.0))) +
        min(max(jtQ.x, jtQ.y), 0.0) - jtRadius;
    float jtCoverage = 1.0 - smoothstep(-0.5, 0.5, jtDistance);
    // Replace the original rectangular margin with a shadow of the rounded
    // frame. It must not depend on stale border/shadow pixels from the client.
    vec2 jtShadowQ = abs(jtLocal - vec2(0.0, 2.0 * jtPixelScale) - jtHalf) -
        (jtHalf - vec2(jtRadius));
    float jtShadowDistance = length(max(jtShadowQ, vec2(0.0))) +
        min(max(jtShadowQ.x, jtShadowQ.y), 0.0) - jtRadius;
    float jtOutside = max(jtShadowDistance, 0.0);
    // Native translucent frame margins must not receive a second box shadow.
    vec2 jtInset = min(vec2(4.0 * jtPixelScale), jtFrame.zw * 0.25);
    // A thick focus decoration covers the inner probes. Look just outside
    // the frame instead, where that decoration cannot hide native transparency.
    bool jtProbeExterior = jtFocusBorderWidth >= 4.0 * jtPixelScale;
    if (jtProbeExterior) jtInset = vec2(-0.5 * jtPixelScale);
    vec2 jtMiddle = jtFrame.xy + jtFrame.zw * 0.5;
    vec2 jtLeft = vec2(jtFrame.x + jtInset.x, jtMiddle.y);
    vec2 jtRight = vec2(jtFrame.x + jtFrame.z - jtInset.x, jtMiddle.y);
    vec2 jtTop = vec2(jtMiddle.x, jtFrame.y + jtInset.y);
    vec2 jtBottom = vec2(jtMiddle.x, jtFrame.y + jtFrame.w - jtInset.y);
    float jtSupport = min(
        min(texture2D(cogl_sampler0, (jtLeft - jtFramebuffer.xy) / jtFramebuffer.zw).a,
            texture2D(cogl_sampler0, (jtRight - jtFramebuffer.xy) / jtFramebuffer.zw).a),
        min(texture2D(cogl_sampler0, (jtTop - jtFramebuffer.xy) / jtFramebuffer.zw).a,
            texture2D(cogl_sampler0, (jtBottom - jtFramebuffer.xy) / jtFramebuffer.zw).a));
    float jtShadowSupport = jtProbeExterior ? smoothstep(0.001, 0.02, jtSupport) :
        smoothstep(0.05, 0.25, jtSupport);
    float jtShadow = 0.16 * exp(-jtOutside * jtOutside / (72.0 * jtPixelScale * jtPixelScale)) *
        jtOpacity * (1.0 - jtCoverage) * jtShadowSupport;
    // Some clients have almost no native shadow margin in their texture.
    // A shadow cut at that texture boundary would form a rectangular halo.
    vec2 jtToTextureEdge = min(cogl_tex_coord_in[0].xy,
        vec2(1.0) - cogl_tex_coord_in[0].xy) * jtFramebuffer.zw;
    jtShadow *= smoothstep(0.0, (4.0 * jtPixelScale),
        min(jtToTextureEdge.x, jtToTextureEdge.y));
    bool jtInsideFrame = jtLocal.x >= 0.0 && jtLocal.y >= 0.0 &&
        jtLocal.x <= jtFrame.z && jtLocal.y <= jtFrame.w;
    vec4 jtContent = jtInsideFrame ? cogl_color_out : vec4(0.0);
    cogl_color_out = jtContent * jtCoverage + vec4(0.0, 0.0, 0.0, jtShadow);
}
`;
