# 把 Tripo 生成的人物模型整理成遊戲用的 public/models/girl.glb、boy.glb（用 Blender 從命令列跑）：
#   "C:/TOOL/blender/blender-5.2.2-windows-x64/blender.exe" -b --python tools/tripo_figure.py -- tools/src/girl_tripo.glb public/models/girl.glb --eyes=0.11,1.15 [預覽圖路徑]
#   "C:/TOOL/blender/blender-5.2.2-windows-x64/blender.exe" -b --python tools/tripo_figure.py -- tools/src/boy_tripo.glb public/models/boy.glb --shorts --eyes=0.106,1.16
# 輸入是 Tripo「智能拆分」後、每個零件各帶一張貼圖的模型（用沒有五官的設定圖生成，臉是乾淨的）。
# 做的事：
#   1. 每個零件的貼圖拼成一張大貼圖（直接搬像素、UV 跟著縮放到各自的格子，不用烘焙）
#   2. 轉成遊戲的座標：面向前方（Blender +X，遊戲 +X）、身高 1.62、兩腳中間在原點
#   3. 綁一副骨架：root（髖）、upper（腰）、head（脖子）、arm.L/R（肩膀）、leg.L/R（髖關節）。
#      男女版比例不同，關節位置各自一組（JOINTS），存進模型（rig 的 extras.joints），遊戲讀模型時一起讀
#      權重照零件分：頭、頭髮、蝴蝶結 → 頭；腿、鞋 → 腿；兩旁的手臂、袖子 → 手臂（肩膀那段和上半身漸變）；
#      裙子 → 身體（裙襬那段分一點給腿）；短褲 → 身體往下漸變到腿；其餘（上衣、領子、領巾）→ 上半身
#   4. 臉：另外複製一層貼著臉的薄片（face），UV 對到遊戲的表情圖（110×110、一格 4 公釐），換表情就是換這層的貼圖。
#      眼睛的位置用 --eyes=離中線距離,高度 給（臉上沒有五官，量不出來）
import bpy, bmesh, sys, math
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
FLAGS = {a for a in argv if a.startswith('--')}
argv = [a for a in argv if not a.startswith('--')]
SRC, DST = argv[0], argv[1]
PREVIEW = argv[2] if len(argv) > 2 else None
SHORTS = '--shorts' in FLAGS   # 穿短褲的（男版）：沒有裙子；短褲往下漸變到腿

H = 1.62                      # 身高
# 關節（遊戲的公尺；Blender 的 -Y 是人物的右手邊）：從 Tripo 零件的範圍量的。HIP_Z、HAND、HAND_Z 下面從零件算
JOINTS = (dict(NECK=1.0, SHOULDER=0.92, SHOULDER_Z=0.17, WAIST=0.71, HIP=0.6) if SHORTS else
          dict(NECK=0.96, SHOULDER=0.88, SHOULDER_Z=0.17, WAIST=0.73, HIP=0.6))
NECK, SHOULDER, SHOULDER_Z, WAIST, HIP = (JOINTS[k] for k in ('NECK', 'SHOULDER', 'SHOULDER_Z', 'WAIST', 'HIP'))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']

# ---- 每個零件：面的方向照 Tripo 存的頂點法線擺正、記下是哪個零件 ----
# 有些面的頂點順序是反的（遊戲裡背面不畫，會看穿、露出裡面的貼圖）。零件不是封閉的，Blender 自動重算方向會猜錯，
# 所以照原檔每個角的法線：面的朝向跟那幾個法線的平均相反，就把這一面翻過來
for o in meshes:
    cn = o.data.corner_normals
    flip = [p.index for p in o.data.polygons
            if p.normal.dot(sum((cn[i].vector for i in p.loop_indices), Vector())) < 0]
    if flip:
        bm = bmesh.new(); bm.from_mesh(o.data); bm.faces.ensure_lookup_table()
        bmesh.ops.reverse_faces(bm, faces=[bm.faces[i] for i in flip], flip_multires=False)
        bm.to_mesh(o.data); bm.free()
        print('FLIP', o.name, len(flip), '/', len(o.data.polygons))
    o.vertex_groups.new(name='P:' + o.name).add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')

# ---- 拼貼圖：每個零件的貼圖（邊長超過 512 的先縮到 512）放進一張 2048 的大圖 ----
# 邊長都是 2 的次方，用四分樹切格子剛好塞得下；每格四周留 2 像素（複製邊緣的顏色），縮小貼圖時才不會混到隔壁格
ATLAS, PAD, CAP = 2048, 2, 512
def part_image(o):
    for s in o.material_slots:
        if s.material and s.material.node_tree:
            n = s.material.node_tree.nodes.get('Image Texture')
            if n and n.image: return n.image
parts = sorted(meshes, key=lambda o: -part_image(o).size[0])
free = [(0, 0, ATLAS)]
cells = {}
for o in parts:
    sz = min(CAP, part_image(o).size[0])
    cand = sorted([f for f in free if f[2] >= sz], key=lambda f: f[2])
    if not cand: raise SystemExit('ATLAS FULL')
    x, y, s = cand[0]; free.remove(cand[0])
    while s > sz:   # 切成四塊，留一塊用，其餘三塊放回去
        s //= 2; free += [(x + s, y, s), (x, y + s, s), (x + s, y + s, s)]
    cells[o.name] = (x, y, s)
apx = [0.0] * (ATLAS * ATLAS * 4)
for o in parts:
    x0, y0, s = cells[o.name]
    im = part_image(o); w = im.size[0]; src = im.pixels[:]
    inner = s - 2 * PAD
    for yy in range(s):
        sy = min(w - 1, max(0, int((yy - PAD + 0.5) * w / inner)))
        row = (y0 + yy) * ATLAS
        for xx in range(s):
            sx = min(w - 1, max(0, int((xx - PAD + 0.5) * w / inner)))
            si = (sy * w + sx) * 4; di = (row + x0 + xx) * 4
            apx[di:di + 4] = src[si:si + 4]
    for l in o.data.uv_layers[0].data:   # UV 縮放到這一格裡面（扣掉四周留的邊）
        u, v = l.uv
        l.uv = ((x0 + PAD + u * inner) / ATLAS, (y0 + PAD + v * inner) / ATLAS)
atlas = bpy.data.images.new('atlas', ATLAS, ATLAS)
atlas.pixels[:] = apx
amat = bpy.data.materials.new('body'); amat.use_nodes = True
tn = amat.node_tree.nodes.new('ShaderNodeTexImage'); tn.image = atlas; tn.name = 'Image Texture'
amat.node_tree.links.new(tn.outputs['Color'], amat.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
for o in meshes:
    o.data.materials.clear(); o.data.materials.append(amat)
print('ATLAS', len(parts), 'parts')

for o in bpy.data.objects:
    o.select_set(o.type == 'MESH')
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
body.name = 'body'
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
zmax = max(v.co.z for v in body.data.vertices)
low = [v.co for v in body.data.vertices if v.co.z < 0.03]   # 兩腳中間的位置：腳底的頂點平均
X0, Y0 = sum(c.x for c in low) / len(low), sum(c.y for c in low) / len(low)
body.data.transform(Matrix.Scale(H / zmax, 4) @ Matrix.Rotation(math.radians(90), 4, 'Z') @ Matrix.Translation((-X0, -Y0, 0)))
body.data.update()

# ---- 每個零件是什麼（頭／腿／手臂／下身的衣服／上半身），照它在身上的範圍判斷 ----
pverts = {}
gname = {g.index: g.name[2:] for g in body.vertex_groups if g.name.startswith('P:')}
vpart = [None] * len(body.data.vertices)
for v in body.data.vertices:
    for g in v.groups:
        if g.group in gname: vpart[v.index] = gname[g.group]; pverts.setdefault(vpart[v.index], []).append(v.co.copy())
role = {}
for n, cs in pverts.items():
    zs = [c.z for c in cs]; ys = [c.y for c in cs]; cyy = sum(ys) / len(ys)
    if max(zs) > NECK + 0.08: r = 'head'
    elif max(zs) < WAIST - 0.06 and max(ys) - min(ys) < 0.3: r = 'leg'
    elif abs(cyy) > 0.12 and (max(zs) > WAIST + 0.06 or abs(cyy) > 0.22): r = 'arm'   # 手掌整個在腰以下，靠離中線夠遠判斷
    elif min(zs) < WAIST + 0.02 and max(zs) <= WAIST + 0.06: r = 'low'
    else: r = 'torso'
    role[n] = r
print('ROLES', {r: sorted(n for n in role if role[n] == r) for r in set(role.values())})
for g in [g for g in body.vertex_groups if g.name.startswith('P:')]: body.vertex_groups.remove(g)
# 從零件量：髖關節離中線多遠（腿的零件左右各自的中心）、手（手臂零件最低那一截的中心）
legy = [abs(sum(c.y for c in pverts[n]) / len(pverts[n])) for n in role if role[n] == 'leg' and len(pverts[n]) > 60]
HIP_Z = sum(legy) / len(legy)
armv = [c for n in role if role[n] == 'arm' for c in pverts[n]]
amin = min(c.z for c in armv)
tip = [c for c in armv if c.z < amin + 0.06]
HAND, HAND_Z = sum(c.z for c in tip) / len(tip) + 0.03, sum(abs(c.y) for c in tip) / len(tip)
JOINTS.update(HIP_Z=round(HIP_Z, 3), HAND=round(HAND, 3), HAND_Z=round(HAND_Z, 3))
print('JOINTS', JOINTS)

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
def classify():
    global uv, vcol, pcol, pavg, vkind
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
classify()
# 頭髮零件上膚色的面：Tripo 把臉頰的顏色烘到側髮的內側，平光下看不出來，遊戲裡一打光就是臉旁邊一塊階梯狀的暗斑（女版很明顯）。
# 頭髮零件（頭上的零件、大部分是棕色的）裡膚色的面直接刪掉，露出後面真正的臉
hairp = {}
for p in body.data.polygons:
    n = vpart[p.vertices[0]]
    if role[n] == 'head': hairp.setdefault(n, []).append(p.index)
skinn = lambda n: sum(pcol[i] in ('skin', 'white') for i in hairp[n])
facepart = max(hairp, key=skinn)   # 膚色的面最多的是頭本身（臉、頭皮），不是頭髮
hair = {n for n, ps in hairp.items() if n != facepart and sum(pcol[i] == 'brown' for i in ps) > 0.5 * len(ps)}
drop = [i for n in hair for i in hairp[n] if pcol[i] in ('skin', 'white')]
if drop:
    bm = bmesh.new(); bm.from_mesh(body.data); bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.faces[i] for i in drop], context='FACES_ONLY')
    bm.to_mesh(body.data); bm.free(); body.data.update()
    classify()
print('HAIRSKIN', len(drop), sorted(hair), 'face part', facepart)

# ---- 骨架 ----
arm_data = bpy.data.armatures.new('rig')
rig = bpy.data.objects.new('rig', arm_data)
bpy.context.scene.collection.objects.link(rig)
bpy.ops.object.select_all(action='DESELECT')
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
rig['joints'] = JOINTS   # 匯出成 extras，遊戲照這個擺骨頭
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

# 權重：照零件（上面的 role）和位置分
groups = {}
for name in ['root', 'upper', 'head', 'arm.L', 'arm.R', 'leg.L', 'leg.R']:
    groups[name] = body.vertex_groups.get(name) or body.vertex_groups.new(name=name)
def setw(vi, ws):
    for g in groups.values(): g.remove([vi])
    for name, w in ws.items():
        if w > 1e-3: groups[name].add([vi], w, 'REPLACE')
clamp = lambda v: min(1.0, max(0.0, v))
hem = {n: min(c.z for c in pverts[n]) for n in role if role[n] == 'low'}
count = {}
for v in body.data.vertices:
    (x, y, z), r = v.co, role[vpart[v.index]]
    side = 'L' if y > 0 else 'R'
    if r == 'head': c, ws = 'head', {'head': 1}
    elif r == 'leg': c, ws = 'leg', {'leg.' + side: 1}
    elif r == 'low' and WAIST - hem[vpart[v.index]] < 0.1:
        c, ws = 'belt', {'root': 1}   # 腰帶、釦子這種窄窄一圈的
    elif r == 'low' and not SHORTS:
        # 裙子跟著身體；但裙襬那段要分一點給腿（越靠近裙襬越多、左右兩邊各跟同側的腿），
        # 不然走路時腿往後擺，大腿會從裙子後面穿出來，看起來像裙子被扯開
        h0 = hem[vpart[v.index]]
        t = 0.3 * clamp((h0 + 0.15 - z) / 0.15); sl = clamp(0.5 + y / 0.42)   # 左右漸變要寬：太陡的話兩腳一前一後，裙子中間會裂開
        c, ws = 'skirt', {'root': 1 - t, 'leg.L': t * sl, 'leg.R': t * (1 - sl)}
    elif r == 'low':   # 短褲：褲襠以下跟著同側的腿
        t = clamp((HIP - z) / 0.1); c, ws = ('leg' if t > 0.99 else 'shorts'), {'leg.' + side: t, 'root': 1 - t}
    elif r == 'arm':   # 手臂、袖子：肩膀那段（靠近身體、又在肩膀高度的）和上半身漸變
        a = 1.0 if z < SHOULDER - 0.1 else clamp((abs(y) - (SHOULDER_Z - 0.06)) / 0.08)
        c, ws = ('arm' if a > 0.99 else 'shoulder'), {'arm.' + side: a, 'upper': 1 - a}
    elif z > NECK - 0.03:
        t = clamp((z - (NECK - 0.03)) / 0.06); c, ws = 'neck', {'head': t, 'upper': 1 - t}
    elif z < WAIST + 0.03:
        t = clamp((WAIST + 0.03 - z) / 0.06); c, ws = 'waist', {'root': t, 'upper': 1 - t}
    else: c, ws = 'upper', {'upper': 1}
    count[c] = count.get(c, 0) + 1
    setw(v.index, ws)
print('WEIGHTS', count)

# ---- 臉 ----
# 臉的面：朝前、在下巴到額頭之間、在臉的輪廓裡（兩旁的側髮不算）；
# 再排除瀏海——瀏海是浮在臉前面的另一層，同一個位置後面還有臉的面（往後 8 公釐以上）的就是瀏海
cand = [p for p in body.data.polygons if p.normal.x > 0.45 and NECK + 0.03 < p.center.z < 1.34 and abs(p.center.y) < 0.165]
# 男版 Tripo 把眼睛做成凸出臉的一層（後面也有臉的面），顏色又是深棕，跟瀏海一樣：
# 在眼睛的範圍裡（離中線 4–16 公分、瀏海尖端以下）、顏色不像頭髮那麼紅的那些面是眼睛，留著
eyeish = lambda p: False and pavg[p.index][0] - pavg[p.index][2] < 75 and 0.04 < abs(p.center.y) < 0.16 and p.center.z < 1.23   # 頭髮偏紅（紅減藍約 100）
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
# 主頭部零件（臉的面大多在它上面）：Tripo 在它的貼圖上連鬢角、瀏海的影子都畫成棕色，但真正的頭髮是另外的零件，
# 沒蓋到的地方（臉頰兩旁）會露出一塊階梯狀的暗斑。這個零件朝前、在臉的高度裡的面，不管什麼顏色都整片抹成膚色
from collections import Counter
headpart = Counter(vpart[body.data.polygons[p.index].vertices[0]] for p in cand).most_common(1)[0][0]
wipe = lambda p: vpart[p.vertices[0]] == headpart and p.normal.x > 0.25 and p.center.z < 1.3
fixed = 0
for p in side:
    li = list(p.loop_indices)
    for t in range(1, len(li) - 1):
        for x, y, w in tri_pixels([uv[i].uv for i in (li[0], li[t], li[t + 1])]):
            i = (y * W + x) * 4
            c = [pix[i + k] ** (1 / 2.2) * 255 for k in range(3)]
            grey = max(c) - min(c) < 45 and 250 < sum(c) < 700
            if kind(c) == 'skin' or grey or pcol[p.index] == 'skin' or wipe(p):   # 膚色的面整片抹（Tripo 原本畫的嘴、眉毛、斑點在這裡，女版左眼下像破皮）
                pix[i], pix[i + 1], pix[i + 2] = lin; fixed += 1
print('CHEEKFIX', len(side), fixed, 'headpart', headpart)
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
# 同一個位置有好幾個頂點（Tripo 的網格在貼圖接縫處沒接起來）：先焊起來再往外推，不然各推各的，三角形之間會裂出細縫，眼睛裡看得到一條亮虛線
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
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

# ---- 平滑著色的記號 ----
# 整個人是平面著色（看得到稜角），但頭部的膚色（臉、耳朵、脖子）在側光下一格一格的很明顯：
# 法線改成平滑的匯出，再用頂點顏色的紅色標出「這裡用平滑」，遊戲的材質照這個在兩種之間混（見 figure.js 的 pixelMat）
for ob in [body] + [o for o in bpy.data.objects if o.name.startswith('face')]:
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    if ob.data.has_custom_normals: bpy.ops.mesh.customdata_custom_splitnormals_clear()
    ob.data.shade_smooth()
# 頭（脖子以上）不是頭髮、蝴蝶結、領子的頂點，加上臉的面用到的頂點、整個主頭部零件（臉頰兩旁原本貼圖是棕色的那幾圈也要平滑，不然背光時一階一階的像黑漬）（女版的膚色很淡，會被分到 white，不能排除）
fp = {v for p in face_polys for v in p.vertices}
sm = [1.0 if v.index in fp or vpart[v.index] == headpart or (v.co.z > NECK + 0.01 and vkind[v.index] not in ('brown', 'red', 'navy')) else 0.0 for v in body.data.vertices]
ca = body.data.color_attributes.new('smooth', 'BYTE_COLOR', 'POINT')
for i, v in enumerate(sm): ca.data[i].color = (v, v, v, 1.0)
body.data.color_attributes.active_color = ca
print('SMOOTHMARK', int(sum(sm)), '/', len(sm))

# ---- 輸出 ----
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=DST, export_format='GLB', export_skins=True, export_animations=False, export_yup=True, export_apply=False,
                          export_vertex_color='ACTIVE', export_extras=True)
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
