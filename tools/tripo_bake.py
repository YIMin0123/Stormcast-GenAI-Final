# 把 Tripo「智能拆分」後沒有貼圖的模型，從原本有貼圖的同一個模型把顏色烘焙過來（用 Blender 從命令列跑）：
#   blender.exe -b --python tools/tripo_bake.py -- 拆分後.glb 有貼圖的原檔.glb 輸出.glb 要刪的零件,... [塗成膚色的零件,...]
# 兩個檔案是同一次生成的，大小、方向一樣，直接疊在一起。要刪的零件（眼睛、眉毛、嘴）先刪掉，臉就剩乾淨的一層。
import bpy, sys
argv = sys.argv[sys.argv.index('--') + 1:]
PARTS, SRC, DST = argv[0], argv[1], argv[2]
DROP = set(argv[3].split(',')) if len(argv) > 3 and argv[3] else set()
# 第 5 個參數：整塊塗成膚色的零件（頭：臉、頭皮；臉上的五官遊戲另外貼，烘過來的顏色在下巴會沾到脖子、領子的暗色）
SKIN = set(argv[4].split(',')) if len(argv) > 4 and argv[4] else set()
SKIN_RGB = (247, 223, 198)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=PARTS)
parts = [o for o in bpy.data.objects if o.type == 'MESH']
for o in parts:
    if o.name in DROP: bpy.data.objects.remove(o)
parts = [o for o in bpy.data.objects if o.type == 'MESH']
# 有些零件裡一部分的面是反的（Blender 看不出來，遊戲裡背面不畫，會看穿頭）：每個零件各自把面的方向統一朝外
import bmesh
for o in parts:
    bm = bmesh.new(); bm.from_mesh(o.data)
    before = [f.normal.copy() for f in bm.faces]
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    flipped = sum(1 for f, n in zip(bm.faces, before) if f.normal.dot(n) < 0)
    bm.to_mesh(o.data); bm.free()
    if flipped: print('FLIP', o.name, flipped, '/', len(o.data.polygons))
    if o.name in SKIN:   # 頭：臉的下半（眼睛以下、朝前的那半）網格凹凸不平，打光後下巴一排三角形忽明忽暗——抹平一點；開口邊（脖子）不動
        bm = bmesh.new(); bm.from_mesh(o.data)
        zs = [v.co.z for v in bm.verts]; z0, z1 = min(zs), max(zs)
        cy = (min(v.co.y for v in bm.verts) + max(v.co.y for v in bm.verts)) / 2
        move = [v for v in bm.verts if not v.is_boundary and v.co.z < z0 + (z1 - z0) * 0.45 and v.co.y < cy]
        for _ in range(8):
            bmesh.ops.smooth_vert(bm, verts=move, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
        bm.to_mesh(o.data); bm.free()
        print('SMOOTH', o.name, len(move))
    a = o.data.attributes.new('skin', 'INT', 'FACE')
    a.data.foreach_set('value', [1 if o.name in SKIN else 0] * len(o.data.polygons))
bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
new = bpy.context.view_layer.objects.active
new.name = 'body'
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=SRC)
src = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in src: o.select_set(True)
bpy.context.view_layer.objects.active = src[0]
if len(src) > 1: bpy.ops.object.join()
old = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
print('NEW', len(new.data.polygons), 'OLD', len(old.data.polygons))

# 新模型：自動展 UV、開一張 1024 的貼圖
bpy.ops.object.select_all(action='DESELECT')
new.select_set(True); bpy.context.view_layer.objects.active = new
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.004)
bpy.ops.object.mode_set(mode='OBJECT')
img = bpy.data.images.new('tex', 1024, 1024)
mat = bpy.data.materials.new('body'); mat.use_nodes = True
nt = mat.node_tree
tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img; tex.name = 'Image Texture'
nt.links.new(tex.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
nt.nodes.active = tex
new.data.materials.clear(); new.data.materials.append(mat)

# 烘焙：只烘顏色（不要光影），從原檔投到新模型
sc = bpy.context.scene
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 1
sc.render.bake.use_pass_direct = False; sc.render.bake.use_pass_indirect = False; sc.render.bake.use_pass_color = True
sc.render.bake.use_selected_to_active = True
sc.render.bake.cage_extrusion = 0.04; sc.render.bake.max_ray_distance = 0.1   # 拆分後的頭髮跟原檔差到 2–4 公分，距離太短會烘到黑色
sc.render.bake.margin = 6
bpy.ops.object.select_all(action='DESELECT')
old.select_set(True); new.select_set(True); bpy.context.view_layer.objects.active = new
bpy.ops.object.bake(type='DIFFUSE')
# 膚色零件：它們在貼圖上的範圍（往外多塗幾格，免得縮小貼圖時邊緣混到別的顏色）整片塗成膚色
if SKIN:
    W, H = img.size
    px = list(img.pixels)
    lin = [(c / 255) ** 2.2 for c in SKIN_RGB]
    uvd = new.data.uv_layers.active.data
    flag = new.data.attributes['skin'].data
    n = 0
    for p in new.data.polygons:
        if not flag[p.index].value: continue
        li = list(p.loop_indices)
        for t in range(1, len(li) - 1):
            xs = [uvd[i].uv.x * W for i in (li[0], li[t], li[t + 1])]; ys = [uvd[i].uv.y * H for i in (li[0], li[t], li[t + 1])]
            (ax, ay), (bx, by), (cx, cy) = zip(xs, ys)
            d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
            if abs(d) < 1e-9: continue
            for y in range(max(0, int(min(ys)) - 2), min(H, int(max(ys)) + 3)):
                for x in range(max(0, int(min(xs)) - 2), min(W, int(max(xs)) + 3)):
                    qx, qy = x + 0.5, y + 0.5
                    l1 = ((by - cy) * (qx - cx) + (cx - bx) * (qy - cy)) / d
                    l2 = ((cy - ay) * (qx - cx) + (ax - cx) * (qy - cy)) / d
                    if min(l1, l2, 1 - l1 - l2) > -0.12:
                        i = (y * W + x) * 4
                        px[i], px[i + 1], px[i + 2] = lin; n += 1
    img.pixels[:] = px
    print('SKINPAINT', n)
img.pack()
bpy.data.objects.remove(old)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=DST, export_format='GLB', export_yup=True)
print('BAKED', DST)
