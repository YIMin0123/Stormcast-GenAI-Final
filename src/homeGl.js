// 港座標在著色器裡的版本（見 frame.js）：港口的矩形（水線、淋不到雨的範圍、燈光圈的範圍）都是用港座標寫的，
// 著色器拿到的卻是世界座標的像素位置，要先轉回港座標再比。uHome = (cos, sin, 原點 x, 原點 z)
import * as THREE from 'three';
import { HOME_YAW, HOME_ORIGIN } from './frame.js';

export const HOME_U = { value: new THREE.Vector4(Math.cos(HOME_YAW), Math.sin(HOME_YAW), HOME_ORIGIN.x, HOME_ORIGIN.z) };

// 貼進著色器：uniform 宣告與 homeLocal()（世界 xz → 港座標 xz）
export const homeGlsl = /* glsl */ `
uniform vec4 uHome;
vec2 homeLocal( vec2 w ) {
	vec2 d = w - uHome.zw;
	return vec2( d.x * uHome.x - d.y * uHome.y, d.x * uHome.y + d.y * uHome.x );
}
`;

// 把用港座標蓋好的東西（港口、看板）擺進世界：原點移過去、轉到港口該朝的方向
export function placeInHome(obj) {
  obj.position.set(HOME_ORIGIN.x, 0, HOME_ORIGIN.z);
  obj.rotation.y = HOME_YAW;
  obj.updateMatrix();
  return obj;
}
