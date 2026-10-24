#!/usr/bin/env python3
"""Render the shipped fragment on a private surfaceless Mesa GLES context.
No desktop, window, session bus or installed extension is contacted.
"""
import ctypes as C
import json
import os
from pathlib import Path
import struct
import subprocess
import tempfile
import zlib

os.environ['LIBGL_ALWAYS_SOFTWARE'] = '1'
os.environ['EGL_PLATFORM'] = 'surfaceless'
root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='just-corner-export-') as tmp:
    script = Path(tmp) / 'export.js'
    script.write_text(f"import * as corners from '{(root / 'src/cornerGeometry.js').as_uri()}';\n"
                      "print(JSON.stringify({declarations: corners.CORNER_DECLARATIONS, fragment: corners.CORNER_FRAGMENT}));")
    shader = json.loads(subprocess.check_output(['gjs', '-m', str(script)], text=True))

egl = C.CDLL('libEGL.so.1'); gl = C.CDLL('libGLESv2.so.2')
def api(lib, name, result, args):
    fn = getattr(lib, name); fn.restype = result; fn.argtypes = args; return fn
ptr = C.c_void_p; integer = C.c_int; uint = C.c_uint; flt = C.c_float
platform_display = api(egl, 'eglGetPlatformDisplay', ptr, [uint, ptr, C.POINTER(integer)])
display = platform_display(0x31DD, None, None)  # EGL_PLATFORM_SURFACELESS_MESA
assert api(egl, 'eglInitialize', uint, [ptr, ptr, ptr])(display, None, None), 'Surfaceless EGL initialization failed'
choose = api(egl, 'eglChooseConfig', uint, [ptr, C.POINTER(integer), C.POINTER(ptr), integer, C.POINTER(integer)])
attrs = (integer * 15)(0x3033, 1, 0x3040, 4, 0x3024, 8, 0x3023, 8, 0x3022, 8, 0x3021, 8, 0x3038, 0, 0)
config = ptr(); count = integer()
assert choose(display, attrs, C.byref(config), 1, C.byref(count)) and count.value
assert api(egl, 'eglBindAPI', uint, [uint])(0x30A0)  # GLES
context = api(egl, 'eglCreateContext', ptr, [ptr, ptr, ptr, C.POINTER(integer)])(
    display, config, None, (integer * 3)(0x3098, 2, 0x3038))
assert context, 'Private GLES context unavailable'
create_surface = api(egl, 'eglCreatePbufferSurface', ptr, [ptr, ptr, C.POINTER(integer)])
make_current = api(egl, 'eglMakeCurrent', uint, [ptr, ptr, ptr, ptr])
destroy_surface = api(egl, 'eglDestroySurface', uint, [ptr, ptr])
get_string = api(gl, 'glGetString', C.c_char_p, [uint])
create_shader = api(gl, 'glCreateShader', uint, [uint])
source_shader = api(gl, 'glShaderSource', None, [uint, integer, C.POINTER(C.c_char_p), ptr])
compile_shader = api(gl, 'glCompileShader', None, [uint])
get_shader = api(gl, 'glGetShaderiv', None, [uint, uint, C.POINTER(integer)])
get_shader_log = api(gl, 'glGetShaderInfoLog', None, [uint, integer, ptr, C.c_char_p])
create_program = api(gl, 'glCreateProgram', uint, [])
attach = api(gl, 'glAttachShader', None, [uint, uint])
link = api(gl, 'glLinkProgram', None, [uint])
get_program = api(gl, 'glGetProgramiv', None, [uint, uint, C.POINTER(integer)])
use = api(gl, 'glUseProgram', None, [uint])
get_uniform = api(gl, 'glGetUniformLocation', integer, [uint, C.c_char_p])
uniform4 = api(gl, 'glUniform4f', None, [integer, flt, flt, flt, flt])
uniform1 = api(gl, 'glUniform1f', None, [integer, flt])
viewport = api(gl, 'glViewport', None, [integer] * 4)
vertex_attr = api(gl, 'glVertexAttribPointer', None, [uint, integer, uint, C.c_ubyte, integer, ptr])
get_attr = api(gl, 'glGetAttribLocation', integer, [uint, C.c_char_p])
enable_attr = api(gl, 'glEnableVertexAttribArray', None, [uint])
draw = api(gl, 'glDrawArrays', None, [uint, integer, integer])
read = api(gl, 'glReadPixels', None, [integer, integer, integer, integer, uint, uint, ptr])
get_error = api(gl, 'glGetError', uint, [])
active_texture = api(gl, 'glActiveTexture', None, [uint])
bind_texture = api(gl, 'glBindTexture', None, [uint, uint])
texture_image = api(gl, 'glTexImage2D', None, [uint, integer, integer, integer, integer, integer, uint, uint, ptr])
texture_parameter = api(gl, 'glTexParameteri', None, [uint, uint, integer])
gen_textures = api(gl, 'glGenTextures', None, [integer, C.POINTER(uint)])
uniform_int = api(gl, 'glUniform1i', None, [integer, integer])


def compile_one(kind, text):
    handle = create_shader(kind); raw = C.c_char_p(text.encode())
    source_shader(handle, 1, C.byref(raw), None); compile_shader(handle)
    ok = integer(); get_shader(handle, 0x8B81, C.byref(ok))
    if not ok.value:
        log = C.create_string_buffer(8192); get_shader_log(handle, len(log), None, log)
        raise AssertionError(log.value.decode())
    return handle

def png(path, w, h, raw):
    def chunk(name, value):
        return struct.pack('>I', len(value)) + name + value + struct.pack('>I', zlib.crc32(name + value))
    rows = b''.join(b'\0' + raw[y*w*4:(y+1)*w*4] for y in reversed(range(h)))
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>2I5B', w, h, 8, 6, 0, 0, 0)) +
                    chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))

try:
    renderer = None
    for scale in [1, 1.5, 2]:
        w, h = int(160 * scale), int(120 * scale)
        surface = create_surface(display, config, (integer * 5)(0x3057, w, 0x3056, h, 0x3038))
        assert surface and make_current(display, surface, surface, context)
        renderer = get_string(0x1F01).decode()
        vertex = compile_one(0x8B31, 'attribute vec2 position; varying vec4 cogl_tex_coord_in[1]; void main(){ gl_Position=vec4(position,0.,1.); cogl_tex_coord_in[0]=vec4(position*.5+.5,0.,1.); }')
        fragment = compile_one(0x8B30, 'precision highp float; varying vec4 cogl_tex_coord_in[1];\n#define cogl_color_out gl_FragColor\n' +
            "uniform sampler2D cogl_sampler0;\n" + shader['declarations'] + '''
void main(){
gl_FragColor = texture2D(cogl_sampler0, cogl_tex_coord_in[0].xy) * jtOpacity;
''' + shader['fragment'] + '\n}')
        program = create_program(); attach(program, vertex); attach(program, fragment); link(program)
        ok = integer(); get_program(program, 0x8B82, C.byref(ok)); assert ok.value, 'Corner shader link failed'
        use(program); viewport(0, 0, w, h)
        uniform4(get_uniform(program, b'jtFramebuffer'), 0, 0, 160, 120)
        uniform4(get_uniform(program, b'jtFrame'), 12, 16, 132, 88)
        uniform1(get_uniform(program, b'jtRadius'), 8)
        uniform1(get_uniform(program, b'jtPixelScale'), 1)
        uniform1(get_uniform(program, b'jtFocusBorderWidth'), 0)
        uniform1(get_uniform(program, b'jtMaskEnabled'), 1)
        uniform1(get_uniform(program, b'jtOpacity'), 1)
        texture = uint(); gen_textures(1, C.byref(texture)); active_texture(0x84C0)
        bind_texture(0x0DE1, texture)
        for name, value in [(0x2801, 0x2600), (0x2800, 0x2600), (0x2802, 0x812F), (0x2803, 0x812F)]:
            texture_parameter(0x0DE1, name, value)
        uniform_int(get_uniform(program, b'cogl_sampler0'), 0)
        def upload(outside=(13, 13, 13, 26), native_margin=False, focused=False,
                   mapping=(0, 0, 160, 120), frame=(12, 16, 132, 88), focus_width=3):
            source = bytearray()
            for row in range(h):
                for col in range(w):
                    x = mapping[0] + (col + .5) * mapping[2] / w - frame[0]
                    y = mapping[1] + (row + .5) * mapping[3] / h - frame[1]
                    inside = 0 <= x <= frame[2] and 0 <= y <= frame[3]
                    border = -1 <= x <= frame[2]+1 and -1 <= y <= frame[3]+1
                    color = (102, 51, 26, 128) if inside else ((0, 0, 0, 255) if border else outside)
                    if native_margin:
                        color = (0, 0, 0, 0)
                        if inside:
                            color = (3, 3, 3, 4) if min(x, frame[2]-x, y, frame[3]-y) < 8 else (102, 51, 26, 128)
                            if focused and min(x, frame[2]-x, y, frame[3]-y) < focus_width:
                                color = (0, 180, 180, 255)
                    source.extend(color)
            raw_source = (C.c_ubyte * len(source)).from_buffer_copy(source)
            texture_image(0x0DE1, 0, 0x1908, w, h, 0, 0x1908, 0x1401, raw_source)
        upload()
        vertices = (flt * 8)(-1, -1, 1, -1, -1, 1, 1, 1)
        attr = get_attr(program, b'position'); enable_attr(attr); vertex_attr(attr, 2, 0x1406, 0, 0, vertices)
        draw(5, 0, 4)
        data = (C.c_ubyte * (w*h*4))(); read(0, 0, w, h, 0x1908, 0x1401, data)
        assert get_error() == 0, 'Corner render produced a GLES error'
        raw = bytes(data)
        def pixel(x, y):
            index = (int(y*scale)*w + int(x*scale))*4
            return raw[index:index+4]
        for x, y in [(12.2, 16.2), (143.2, 16.2), (12.2, 103.2), (143.2, 103.2)]:
            assert max(pixel(x, y)[:3]) <= 1 and pixel(x, y)[3] < 45, ('Corner must contain only the rounded shadow', scale, x, y, pixel(x, y))
        assert abs(pixel(80, 60)[3] - 128) <= 1, 'Center transparency must remain unchanged'
        assert abs(pixel(80, 17)[3] - 128) <= 1, 'Straight frame edge must remain visible'
        assert any(30 < raw[i] < 120 for i in range(3, len(raw), 4)), 'Rounded edges must be antialiased'
        assert pixel(5, 5)[3] < pixel(80, 105)[3] <= 41, 'Rounded shadow must fade away from the frame'
        assert pixel(80, 104.2)[3] <= 41, 'Opaque one-pixel square outline must be removed outside the frame'
        assert max(pixel(5, 5)[:3]) <= 1, 'Colored rectangular client margin must not survive the mask'
        original = raw
        # Changing exterior input pixels must never alter the new rounded shadow.
        upload(outside=(204, 26, 102, 255))
        draw(5, 0, 4); read(0, 0, w, h, 0x1908, 0x1401, data)
        assert bytes(data) == original, 'Original rectangular shadow/border must not leak into output'
        uniform1(get_uniform(program, b'jtOpacity'), .5)
        draw(5, 0, 4); read(0, 0, w, h, 0x1908, 0x1401, data); faded = bytes(data)
        for i in range(len(original)):
            assert abs(faded[i] * 2 - original[i]) <= 2, 'Window and shadow must fade together'
        uniform1(get_uniform(program, b'jtOpacity'), 0)
        draw(5, 0, 4); read(0, 0, w, h, 0x1908, 0x1401, data)
        assert not any(data), 'Fully faded window must never retain a visible shadow'
        uniform1(get_uniform(program, b'jtOpacity'), 1)
        for index in range(0, len(raw), 4):
            assert max(raw[index:index+3]) <= raw[index+3], 'Mask must retain premultiplied alpha'
        output = Path(tempfile.gettempdir()) / f'justtiling-corners-{scale:g}x.png'
        png(output, w, h, raw)
        uniform1(get_uniform(program, b'jtMaskEnabled'), 0); draw(5, 0, 4)
        read(0, 0, w, h, 0x1908, 0x1401, data); raw = bytes(data)
        assert abs(pixel(12.2, 16.2)[3] - 128) <= 1, 'Unavailable mapping must show the original square window'
        # Native translucent resize margins, such as Flutter windows, already
        # carry a faint frame. Rounding must not add an opaque rectangular halo.
        uniform1(get_uniform(program, b'jtMaskEnabled'), 1)
        for focused in [False, True]:
            upload(native_margin=True, focused=focused)
            draw(5, 0, 4); read(0, 0, w, h, 0x1908, 0x1401, data); raw = bytes(data)
            assert pixel(80, 105)[3] == 0, 'Native transparent margins must not gain a second outer shadow'
            assert pixel(10, 60)[3] == 0, 'Transparent left margin must not gain a rectangular halo'
            assert abs(pixel(80, 60)[3] - 128) <= 1, 'Native margin detection must preserve application content'
            assert pixel(16, 60)[3] <= 4, 'Native translucent inset must not become more opaque'
        png(Path(tempfile.gettempdir()) / f'justtiling-native-margin-{scale:g}x.png', w, h, raw)
        # Changing curvature must not move the transparency probes into the
        # application's interior and reintroduce a shadow around native insets.
        for requested_radius in [0, 4, 16, 32, 64]:
            uniform1(get_uniform(program, b'jtRadius'), min(requested_radius, 44))
            upload(native_margin=True, focused=True)
            draw(5, 0, 4); read(0, 0, w, h, 0x1908, 0x1401, data); raw = bytes(data)
            assert pixel(80, 105)[3] == 0, ('Custom radius must preserve native transparent margins', scale, requested_radius)
            assert abs(pixel(80, 60)[3] - 128) <= 1, 'Custom radius must preserve the window center'
        uniform1(get_uniform(program, b'jtRadius'), 8)
        for width in [1, 2, 3, 7, 8]:
            uniform1(get_uniform(program, b'jtFocusBorderWidth'), width)
            upload(native_margin=True, focused=True, focus_width=width)
            draw(5, 0, 4); read(0, 0, w, h, 0x1908, 0x1401, data); raw = bytes(data)
            assert pixel(80, 105)[3] == 0 and pixel(10, 60)[3] == 0, ('Thicker focus borders must not revive native rectangular halos', scale, width)
            assert abs(pixel(80, 60)[3] - 128) <= 1, 'Thicker borders must preserve application content'
            upload()
            draw(5, 0, 4); read(0, 0, w, h, 0x1908, 0x1401, data); raw = bytes(data)
            assert 0 < pixel(80, 105)[3] <= 41, 'Opaque native frames must keep a soft shadow with thick borders'
        uniform1(get_uniform(program, b'jtFocusBorderWidth'), 0)
        # A client buffer may end only one logical pixel outside the frame.
        # Its synthetic shadow must fade at the real texture edge, not be cropped.
        uniform4(get_uniform(program, b'jtFramebuffer'), -1, -1, 134, 90)
        uniform4(get_uniform(program, b'jtFrame'), 0, 0, 132, 88)
        upload(mapping=(-1, -1, 134, 90), frame=(0, 0, 132, 88))
        draw(5, 0, 4); read(0, 0, w, h, 0x1908, 0x1401, data); tight = bytes(data)
        edge_alphas = [tight[(row*w+col)*4+3] for row in range(h) for col in range(w)
                       if row in (0, h-1) or col in (0, w-1)]
        assert max(edge_alphas) <= 3, 'Tight native buffers must not cut the shadow into a visible rectangle'
        print(f'Corner shader pixels OK at {scale:g}x: four corners, opaque square outlines, native translucent margins, tight buffer edges, rounded shadows and animation opacity. {output}')
        make_current(display, None, None, None); destroy_surface(display, surface)
    print(f'Private software renderer: {renderer}. No compositor or user session used.')
finally:
    make_current(display, None, None, None)
    api(egl, 'eglDestroyContext', uint, [ptr, ptr])(display, context)
    api(egl, 'eglTerminate', uint, [ptr])(display)
