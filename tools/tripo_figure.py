# 把 Tripo 生成的人物模型整理成遊戲用的 public/models/girl.glb、boy.glb（用 Blender 從命令列跑）：
#   "C:/TOOL/blender/blender-5.2.2-windows-x64/blender.exe" -b --python tools/tripo_figure.py -- tools/src/girl_tripo.glb public/models/girl.glb [預覽圖路徑]
#   男版：先用 tools/tripo_bake.py 把 Tripo 拆分後的模型（刪掉眼睛、眉毛、嘴）烘上原本的貼圖 → tools/src/boy_baked.glb，
#        再 ... -- tools/src/boy_baked.glb public/models/boy.glb --shorts --eyes=0.106,1.16
# 做的事：
#   1. 轉成遊戲的座標：面向前方（Blender +X，遊戲 +X）、身高 1.62、兩腳中間在原點
#   2. 綁一副骨架，關節跟原本程式拼的人物一樣：root（髖）、upper（腰）、head（脖子）、arm.L/R（肩膀）、leg.L/R（髖關節）
#      權重先讓 Blender 自動算，再照貼圖顏色修：肩膀以上的棕色（頭髮）、上面的紅色（蝴蝶結）全歸頭；腰以下的深藍（裙子）全歸身體，不跟著腿擺
#   3. 臉：把 Tripo 畫在貼圖上的眼睛、嘴、腮紅抹成膚色；另外複製一層貼著臉的薄片（face），
#      UV 對到遊戲的表情圖（110×110、一格 4 公釐、眼睛中心在圖中心下方 6 公分、左右各 11.2 公分），換表情就是換這層的貼圖
import bpy, bmesh, sys, math
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
FLAGS = {a for a in argv if a.startswith('--')}
argv = [a for a in argv if not a.startswith('--')]
SRC, DST = argv[0], argv[1]
PREVIEW = argv[2] if len(argv) > 2 else None
SHORTS = '--shorts' in FLAGS   # 穿短褲的（男版）：沒有裙子；腰以下、腿以上的褲子歸身體，往下漸變到腿

H = 1.62                      # 身高
X0, Y0 = -0.033, -0.04        # 原檔裡兩腳中間的位置（量出來的）
# 關節（遊戲的公尺；Blender 的 -Y 是人物的右手邊）
HIP, HIP_Z = 0.486, 0.151
WAIST = 0.76
SHOULDER, SHOULDER_Z = 0.923, 0.219
HAND, HAND_Z = 0.60, 0.373
NECK = 0.97

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
for o in bpy.data.objects:
    o.select_set(o.type == 'MESH')
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
body.name = 'body'
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
zmax = max(v.co.z for v in body.data.vertices)
if SHORTS:   # 兩腳中間的位置直接從腳底的頂點算（女版沿用原本量的數字，輸出才不會變）
    low = [v.co for v in body.data.vertices if v.co.z < 0.03]
    X0, Y0 = sum(c.x for c in low) / len(low), sum(c.y for c in low) / len(low)
body.data.transform(Matrix.Scale(H / zmax, 4) @ Matrix.Rotation(math.radians(90), 4, 'Z') @ Matrix.Translation((-X0, -Y0, 0)))
body.data.update()

# ---- 貼圖顏色分類 ----
img = body.data.materials[0].node_tree.nodes['Image Texture'].image if body.data.materials[0].node_tree.nodes.get('Image Texture') else bpy.data.images[0]
W, Hh = img.size
pix = list(img.pixels)
def tex(u, v):
    x = min(W - 1, max(0, int(u * W))); y = min(Hh - 1, max(0, int(v * Hh))); i = (y * W + x) * 4
    return [pix[i + k] ** (1 / 2.2) * 255 for k in range(3)]
def kind(c):
    r, g, b = c
    if r > 200 and g < 120: return 'red'
    if b > r + 10 and b > 130: return 'navy'
    # 棕色（頭髮、靴子），連陰影裡較暗的也算：紅 > 綠 > 藍、偏暖，又沒有膚色那麼亮（眼睛的深色是灰黑的，不偏暖）
    if r < 215 and r > g > b and r - b > 35 and r + g + b > 150: return 'brown'
    if r > 225 and 195 < g < 235 and 170 < b < 210: return 'skin'
    if r > 200 and g > 190 and b > 190: return 'white'
    if r + g + b < 330: return 'dark'
    return 'other'
uv = body.data.uv_layers[0].data
vcol = [[0, 0, 0, 0] for _ in body.data.vertices]
pcol, pavg = [], []
for p in body.data.polygons:
    acc = [0, 0, 0]
    for li in p.loop_indices:
        c = tex(*uv[li].uv)
        acc = [acc[k] + c[k] for k in range(3)]
        vi = body.data.loops[li].vertex_index
        for k in range(3): vcol[vi][k] += c[k]
        vcol[vi][3] += 1
    pavg.append([a / len(p.loop_indices) for a in acc])
    pcol.append(kind(pavg[-1]))
vkind = [kind([c[k] / max(1, c[3]) for k in range(3)]) for c in vcol]

# ---- 骨架 ----
arm_data = bpy.data.armatures.new('rig')
rig = bpy.data.objects.new('rig', arm_data)
bpy.context.scene.collection.objects.link(rig)
bpy.ops.object.select_all(action='DESELECT')
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
def bone(name, h, t, parent=None):
    b = arm_data.edit_bones.new(name)
    b.head, b.tail = Vector(h), Vector(t)
    if parent: b.parent = arm_data.edit_bones[parent]
bone('root', (0, 0, HIP), (0, 0, WAIST))
bone('upper', (0, 0, WAIST), (0, 0, NECK), 'root')
bone('head', (0, 0, NECK), (0, 0, 1.45), 'upper')
for s, nm in [(-1, 'R'), (1, 'L')]:
    bone('arm.' + nm, (0, s * SHOULDER_Z, SHOULDER), (0, s * HAND_Z, HAND), 'upper')
    bone('leg.' + nm, (0, s * HIP_Z, HIP), (0, s * HIP_Z, 0.06), 'root')
bpy.ops.object.mode_set(mode='OBJECT')
body.select_set(True); rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_NAME')

# 權重：Tripo 的網格不是封閉的，Blender 自動算權重會失敗，所以照位置和貼圖顏色自己分：
#   頭髮（肩膀以上的棕色）、蝴蝶結、脖子以上 → 頭；裙子（腰以下的深藍）→ 身體（不跟腿擺）；
#   裙襬以下 → 左右腿；兩旁（離身體中線夠遠）→ 手臂，肩膀那一段和上半身漸變；其餘（上衣、領子、領巾）→ 上半身；脖子那段頭和上半身漸變
groups = {}
for name in ['root', 'upper', 'head', 'arm.L', 'arm.R', 'leg.L', 'leg.R']:
    groups[name] = body.vertex_groups.get(name) or body.vertex_groups.new(name=name)
def setw(vi, ws):
    for g in groups.values(): g.remove([vi])
    for name, w in ws.items():
        if w > 1e-3: groups[name].add([vi], w, 'REPLACE')
clamp = lambda v: min(1.0, max(0.0, v))
count = {}
for v in body.data.vertices:
    k, (x, y, z) = vkind[v.index], v.co
    side = 'L' if y > 0 else 'R'
    if (k == 'brown' and z > 0.8) or (k == 'red' and z > 1.25) or z > NECK + 0.05: c, ws = 'head', {'head': 1}
    elif not SHORTS and k == 'navy' and z < 0.84: c, ws = 'skirt', {'root': 1}
    elif SHORTS and z < WAIST - 0.03 and abs(y) < 0.2:
        t = clamp((0.62 - z) / 0.08); c, ws = ('leg' if t > 0.99 else 'shorts'), {'leg.' + side: t, 'root': 1 - t}
    elif z < 0.53: c, ws = 'leg', {'leg.' + side: 1}
    elif z > NECK - 0.02:
        t = clamp((z - (NECK - 0.02)) / 0.07); c, ws = 'neck', {'head': t, 'upper': 1 - t}
    else:
        a = clamp((abs(y) - 0.185) / 0.06)
        c, ws = ('arm' if a > 0.99 else 'shoulder' if a > 0 else 'upper'), {'arm.' + side: a, 'upper': 1 - a}
    count[c] = count.get(c, 0) + 1
    setw(v.index, ws)
print('WEIGHTS', count)

# ---- 臉 ----
# 臉的面：朝前、在下巴到額頭之間、在臉的輪廓裡（兩旁的側髮不算）；
# 再排除瀏海——瀏海是浮在臉前面的另一層，同一個位置後面還有臉的面（往後 8 公釐以上）的就是瀏海
cand = [p for p in body.data.polygons if p.normal.x > 0.45 and NECK + 0.03 < p.center.z < 1.34 and abs(p.center.y) < 0.165]
# 男版 Tripo 把眼睛做成凸出臉的一層（後面也有臉的面），顏色又是深棕，跟瀏海一樣：
# 在眼睛的範圍裡（離中線 4–16 公分、瀏海尖端以下）、顏色不像頭髮那麼紅的那些面是眼睛，留著
eyeish = lambda p: SHORTS and pavg[p.index][0] - pavg[p.index][2] < 75 and 0.04 < abs(p.center.y) < 0.16 and p.center.z < 1.23   # 頭髮偏紅（紅減藍約 100）
cand = [p for p in cand if eyeish(p) or not any(abs(q.center.y - p.center.y) < 0.025 and abs(q.center.z - p.center.z) < 0.025
                                   and q.center.x < p.center.x - 0.008 for q in cand)]
# 1. 找眼睛（臉上最暗的那些像素）的三維位置；2. 把這些面在貼圖上的範圍抹成膚色（棕色的像素是瀏海，不抹）
skin_samples, eye_pts, paint = [], [], []
def tri_pixels(uvs):
    xs = [u.x * W for u in uvs]; ys = [u.y * Hh for u in uvs]
    x0, x1, y0, y1 = int(min(xs)), int(max(xs)) + 1, int(min(ys)), int(max(ys)) + 1
    (ax, ay), (bx, by), (cx, cy) = zip(xs, ys)
    d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if abs(d) < 1e-9: return
    for y in range(max(0, y0), min(Hh, y1)):
        for x in range(max(0, x0), min(W, x1)):
            px, py = x + 0.5, y + 0.5
            l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d
            l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d
            l3 = 1 - l1 - l2
            if min(l1, l2, l3) >= -0.02: yield x, y, (l1, l2, l3)
face_polys = cand
for p in cand:
    li = list(p.loop_indices)
    for t in range(1, len(li) - 1):
        ids = [li[0], li[t], li[t + 1]]
        uvs = [uv[i].uv for i in ids]
        cos = [body.data.vertices[body.data.loops[i].vertex_index].co for i in ids]
        for x, y, w in tri_pixels(uvs):
            i = (y * W + x) * 4
            c = [pix[i + k] ** (1 / 2.2) * 255 for k in range(3)]
            paint.append(i)
            if kind(c) == 'skin': skin_samples.append(c)
            elif (sum(c) < 205) if SHORTS else (sum(c) < 260 and c[0] - c[2] < 70): eye_pts.append(cos[0] * w[0] + cos[1] * w[1] + cos[2] * w[2])
print('FACEPOLYS', len(face_polys), len(skin_samples), len(eye_pts))
skin = [sorted(s[k] for s in skin_samples)[len(skin_samples) // 2] for k in range(3)]
lin = [(v / 255) ** 2.2 for v in skin]
for i in set(paint):
    pix[i], pix[i + 1], pix[i + 2] = lin
# 臉旁邊（臉頰、耳前）不在上面那些面裡，但 Tripo 在那裡留了灰灰髒髒的陰影：膚色或灰色的像素一律抹成同一個膚色，頭髮的棕色不動
keep_face = {p.index for p in cand}
side = [p for p in body.data.polygons if p.index not in keep_face and p.normal.x > -0.2
        and NECK < p.center.z < 1.36 and abs(p.center.y) < 0.21]
fixed = 0
for p in side:
    li = list(p.loop_indices)
    for t in range(1, len(li) - 1):
        for x, y, w in tri_pixels([uv[i].uv for i in (li[0], li[t], li[t + 1])]):
            i = (y * W + x) * 4
            c = [pix[i + k] ** (1 / 2.2) * 255 for k in range(3)]
            grey = max(c) - min(c) < 45 and 250 < sum(c) < 700
            if kind(c) == 'skin' or grey:
                pix[i], pix[i + 1], pix[i + 2] = lin; fixed += 1
print('CHEEKFIX', len(side), fixed)
img.pixels[:] = pix
img.update(); img.pack()
# 眼睛：只看臉中間偏兩旁的暗點（避開嘴、瀏海邊緣），各取中位數；兩眼高度取平均（兩眼本來就同高）
eR = [p for p in eye_pts if -0.17 < p.y < -0.03 and p.z > 1.05]; eL = [p for p in eye_pts if 0.03 < p.y < 0.17 and p.z > 1.05]
med = lambda ps: Vector([sorted(p[i] for p in ps)[len(ps) // 2] for i in range(3)])
eyeR, eyeL = (med(eR), med(eL)) if eR and eL else (Vector((0.15, -0.1, 1.15)), Vector((0.15, 0.1, 1.15)))   # 抓不到就等下面的 --eyes 給
print('EYEPTS', len(eR), len(eL))
eyeR.z = eyeL.z = (eyeR.z + eyeL.z) / 2
# 偵測不準的（男版的眼睛是很小的深色島，抓到的點很少）可以直接給：--eyes=離中線距離,高度（從正交正視圖量）
for f in FLAGS:
    if f.startswith('--eyes='):
        ey, ez = map(float, f[7:].split(','))
        eyeR.y, eyeL.y, eyeR.z, eyeL.z = -ey, ey, ez, ez
print('EYES', len(eye_pts), tuple(round(v, 3) for v in eyeR), tuple(round(v, 3) for v in eyeL), 'skin', [round(v) for v in skin])

# 臉的薄片：複製臉那些面、沿法線往外推 5 公釐、UV 對到表情圖
k = (eyeL.y - eyeR.y) / 0.224          # 表情圖要放大幾倍（兩眼中心距離對齊）
S = 0.44 * k
cy, cz = (eyeL.y + eyeR.y) / 2, (eyeL.z + eyeR.z) / 2 + 0.06 * k
bm = bmesh.new(); bm.from_mesh(body.data)
keep = {p.index for p in face_polys}
# 臉的面外圍再加一圈：朝前、而且幾乎全是膚色的面（眼睛、淚痕比臉的面稍大的話，超出去的那段才不會被切掉）。
# 瀏海、側髮不是膚色，不會被加進來
def skin_frac(p):
    li = list(p.loop_indices); n = ok = 0
    for t in range(1, len(li) - 1):
        for x, y, w in tri_pixels([uv[i].uv for i in (li[0], li[t], li[t + 1])]):
            i = (y * W + x) * 4; n += 1
            ok += abs(pix[i] - lin[0]) < 1e-4 and abs(pix[i + 2] - lin[2]) < 1e-4
    return ok / max(n, 1)
ring = [p.index for p in side if p.normal.x > 0.2 and p.center.z > NECK + 0.03 and skin_frac(p) > 0.85]
keep |= set(ring)
print('RING', len(ring))
bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep], context='FACES')
bm.normal_update()
for v in bm.verts: v.co += v.normal * 0.005
luv = bm.loops.layers.uv.active
for f in bm.faces:
    for l in f.loops:
        l[luv].uv = (0.5 + (l.vert.co.y - cy) / S, 0.5 - (l.vert.co.z - cz) / S)
face_me = bpy.data.meshes.new('face'); bm.to_mesh(face_me); bm.free()
face_me.materials.clear()
fmat = bpy.data.materials.new('face'); face_me.materials.append(fmat)
face = bpy.data.objects.new('face', face_me)
bpy.context.scene.collection.objects.link(face)
face.parent = rig
face.vertex_groups.new(name='head').add(list(range(len(face_me.vertices))), 1.0, 'REPLACE')
face.modifiers.new('rig', 'ARMATURE').object = rig
print('FACE', len(face_me.polygons), 'polys, scale', round(k, 3), 'center', round(cy, 3), round(cz, 3))

# ---- 輸出 ----
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=DST, export_format='GLB', export_skins=True, export_animations=False, export_yup=True, export_apply=False)
print('EXPORTED', DST)

# ---- 預覽：擺幾個姿勢看權重對不對 ----
if PREVIEW:
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'TEXTURE'
    sc.render.resolution_x, sc.render.resolution_y = 420, 560
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.0
    pb = rig.pose.bones
    poses = {
        'rest': {},
        'walk': {'leg.L': ('Y', 0.7), 'leg.R': ('Y', -0.7), 'arm.L': ('Y', -0.6), 'arm.R': ('Y', 0.6), 'head': ('X', 0.4)},
        'wave': {'arm.R': ('X', 2.4), 'upper': ('Y', 0.5), 'head': ('Z', 0.4)},
    }
    for name, pose in poses.items():
        for b in pb: b.rotation_mode = 'XYZ'; b.rotation_euler = (0, 0, 0)
        for bn, (ax, a) in pose.items():
            e = [0, 0, 0]; e['XYZ'.index(ax)] = a; pb[bn].rotation_euler = e
        for view, (loc, rot) in {'front': ((4, 0, 0.8), (90, 0, 90)), 'side': ((0, -4, 0.8), (90, 0, 0))}.items():
            cam.location = loc; cam.rotation_euler = [math.radians(a) for a in rot]
            sc.render.filepath = f'{PREVIEW}_{name}_{view}.png'
            bpy.ops.render.render(write_still=True)
