"use strict";
/* =========================================================
 * 综合罗盘(23 环旋转)渲染:金色系深色风格,四角含四象 SVG(img/sixiang/*.svg)。
 * 网格门控脚本(仅网格模式注入):☯ 弹窗点击时调用 window.__renderEvoChart(svg)
 * 在弹窗的 <svg> 内直接渲染,不使用 iframe。
 * IIFE 封装,不污染全局;清爽模式不注入即不执行。
 * ========================================================= */
(function () {

const NS="http://www.w3.org/2000/svg", C=1200;
function renderEvoChart(svg) {
  let P = svg;
function E(t,a,p){const e=document.createElementNS(NS,t);for(const k in a)e.setAttribute(k,a[k]);(p||P).appendChild(e);return e}
function pt(r,a){const t=a*Math.PI/180;return{x:C+r*Math.sin(t),y:C-r*Math.cos(t)}}
function arc(r,a0,a1){const p0=pt(r,a0),p1=pt(r,a1);return`M${p0.x},${p0.y}A${r},${r},0,${a1-a0>180?1:0},1,${p1.x},${p1.y}`}
function circle(r,w){E("circle",{cx:C,cy:C,r,fill:"none",stroke:"rgba(232,220,192,.75)","stroke-width":w||1.2})}
function sector(r0,r1,a0,a1,fill){const p0=pt(r1,a0),p1=pt(r1,a1),p2=pt(r0,a1),p3=pt(r0,a0);
  E("path",{d:`M${p0.x},${p0.y}A${r1},${r1},0,0,1,${p1.x},${p1.y}L${p2.x},${p2.y}A${r0},${r0},0,0,0,${p3.x},${p3.y}Z`,fill,stroke:"rgba(232,220,192,.75)","stroke-width":.8})}
function mkText(fs,a,cls){return E("text",{"font-size":fs,"text-anchor":"middle","dominant-baseline":"central",
  fill:"#f0d98c",class:cls||""})}
function radialText(s,a,r0,step,fs){for(let i=0;i<s.length;i++){const p=pt(r0-i*step,a);
  const e=mkText(fs,a);e.setAttribute("x",p.x);e.setAttribute("y",p.y);
  e.setAttribute("transform",`rotate(${a},${p.x},${p.y})`);e.textContent=s[i]}}
function horText(s,a,r,fs){const p=pt(r,a);const e=mkText(fs,0);
  e.setAttribute("x",p.x);e.setAttribute("y",p.y);
  e.setAttribute("transform",`rotate(${a},${p.x},${p.y})`);e.textContent=s}
function tangText(s,a,r,fs,cls){const p=pt(r,a);const e=mkText(fs,a,cls);
  e.setAttribute("x",p.x);e.setAttribute("y",p.y);
  e.setAttribute("transform",`rotate(${a},${p.x},${p.y})`);e.textContent=s}
function cells(n,r0,r1,off){for(let i=0;i<n;i++){const a=(off||0)+i*360/n,p0=pt(r0,a),p1=pt(r1,a);
  E("line",{x1:p0.x,y1:p0.y,x2:p1.x,y2:p1.y,stroke:"rgba(232,220,192,.75)","stroke-width":1})}}
/* 方向规则：1 太极顺时针，其后逐环反向（奇顺偶逆） */
function ring(k){const g=E("g",{},svg);
  E("animateTransform",{attributeName:"transform",attributeType:"XML",type:"rotate",
    from:`0 ${C} ${C}`,to:`${k%2?360:-360} ${C} ${C}`,dur:(k===1?150:90+k*6)+"s",repeatCount:"indefinite"},g);
  P=g}

/* ================= 数据 ================= */
const M24=["午","丁","未","坤","申","庚","酉","辛","戌","乾","亥","壬","子","癸","丑","艮","寅","甲","卯","乙","辰","巽","巳","丙"];
const TERMS=["夏至","小暑","大暑","立秋","处暑","白露","秋分","寒露","霜降","立冬","小雪","大雪","冬至","小寒","大寒","立春","雨水","惊蛰","春分","清明","谷雨","立夏","小满","芒种"];
const PHEN=[["鹿角解","蜩始鸣","半夏生"],["温风至","蟋蟀居壁","鹰始鸷"],["腐草为萤","土润溽暑","大雨时行"],
["凉风至","白露降","寒蝉鸣"],["鹰乃祭鸟","天地始肃","禾乃登"],["鸿雁来","玄鸟归","群鸟养羞"],
["雷始收声","蛰虫坯户","水始涸"],["鸿雁来宾","菊有黄花","雀入水为蛤"],["豺乃祭兽","草木黄落","蛰虫咸俯"],
["水始冰","地始冻","雉入水为蜃"],["虹藏不见","天气上升","闭塞成冬"],["鹖不鸣","虎始交","荔挺出"],
["蚯蚓结","麋角解","水泉动"],["雁北乡","鹊始巢","雉始雊"],["鸡始乳","征鸟厉疾","水泽腹坚"],
["东风解冻","蛰虫始振","鱼陟负冰"],["獭祭鱼","候雁北","草木萌动"],["桃始华","仓庚鸣","鹰化为鸠"],
["玄鸟至","雷乃发声","始电"],["桐始华","田鼠化鴽","虹始见"],["萍始生","鸣鸠拂羽","戴胜降桑"],
["蝼鸣","蚯蚓出","王瓜生"],["苦菜秀","靡草死","麦秋至"],["螳螂生","鵙始鸣","反舌无声"]].flat();
const HEX=["乾","姤","大过","鼎","恒","巽","井","蛊","升","讼","困","未济","解","涣","坎","蒙","师","遁","咸","旅","小过","渐","蹇","艮","谦","否","萃","晋","豫","观","比","剥","坤","复","颐","屯","益","震","噬嗑","随","无妄","明夷","贲","既济","家人","丰","离","革","同人","临","损","节","中孚","归妹","睽","兑","履","泰","大畜","需","小畜","大壮","大有","夬"];
const TR={乾:[1,1,1],兑:[1,1,0],离:[1,0,1],震:[1,0,0],巽:[0,1,1],坎:[0,1,0],艮:[0,0,1],坤:[0,0,0]};
const U=["乾","兑","离","震","巽","坎","艮","坤"], RU=[...U].reverse(), LG=["巽","坎","艮","坤","震","离","兑","乾"];
function hexLines(k){if(k===0)return[1,1,1,1,1,1];
  const lo=LG[Math.floor((k-1)/8)], up=k<=32?U[(k-1)%8]:RU[(k-33)%8];
  return TR[lo].concat(TR[up])}
const GAN="甲乙丙丁戊己庚辛壬癸".split(""), ZHI="子丑寅卯辰巳午未申酉戌亥".split("");
const jiazi=i=>GAN[i%10]+ZHI[i%12];
const XIU=[["角","十二太",12,"木"],["亢","九半",9,"金"],["氐","十六",16,"土"],["房","五",5,"日"],["心","六",6,"月"],["尾","十八",18,"火"],["箕","九",9,"水"],
["斗","二十六",26,"木"],["牛","八",8,"金"],["女","十二",12,"土"],["虚","九少",9,"日"],["危","十六",16,"月"],["室","十八",18,"火"],["壁","九",9,"水"],
["奎","十六",16,"木"],["娄","十二",12,"金"],["胃","十五",15,"土"],["昴","十一",11,"日"],["毕","十六",16,"月"],["觜","九",9,"火"],["参","九",9,"水"],
["井","三十三",33,"木"],["鬼","二",2,"金"],["柳","十三半",13,"土"],["星","六太",6,"日"],["张","十七太",17,"月"],["翼","十八",18,"火"],["轸","十八",18,"水"]];
const SIXIANG=[["太阳",0],["少阳",90],["太阴",180],["少阴",270]];
const SANCAI=[["天",0],["地",120],["人",240]];
const WUXING=["火","土","金","水","木"];
const LIUDAO=[["天道",0],["阿修罗",60],["地狱",120],["畜生",180],["饿鬼",240],["人道",300]];
const JIUGONG=[["离九",0],["坤二",40],["兑七",80],["乾六",120],["坎一",160],["艮八",200],["震三",240],["巽四",280],["中五",320]];
const BEIDOU=["贪狼","巨门","禄存","文曲","廉贞","武曲","破军","左辅","右弼"];
const CHANGSHENG=["长生","沐浴","冠带","临官","帝旺","衰","病","死","墓","绝","胎","养"];
const NUM9=["壹","贰","叁","肆","伍","陆","柒","捌","玖"];
const TG=["天魁","天罡","天机","天闲","天勇","天雄","天猛","天威","天英","天贵","天富","天满","天孤","天伤","天立","天源","天暗","天空","天速","天异","天杀","天究","天微","天退","天寿","天剑","天平","天损","天牢","天慧","天巧","天哭","天祐","天护","天佑","天察"];
const DS=["地魁","地煞","地机","地魔","地勇","地雄","地杰","地飞","地英","地贵","地富","地满","地孤","地伤","地立","地灵","地暗","地轴","地佐","地佑","地奇","地杀","地金","地退","地囚","地盗","地波","地浪","地蛮","地丑","地数","地隐","地异","地智","地巧","地雅","地顺","地乐","地奏","地卑","地短","地角","地匿","地暴","地贼","地狂","地疾","地猾","地僻","地影","地刑","地奴","地平","地缺","地硬","地猛","地悍","地镇","地阴","地全","地安","地察","地幕","地玄","地音","地速","地鬼","地盗","地鼠","地兽","地狗","地终"];

/* ================= 静止件：外方盘 + 尺标 ================= */
P=svg;
/* 外方盘与尺标刻度线已去除(用户要求),仅保留天池十字天心十道 */

/* ================= 1 太极（顺时针 150s/圈） ================= */
ring(1);
E("circle",{cx:C,cy:C,r:110,fill:"#f0d98c"});
E("path",{d:`M1200,1310 A110,110 0 0 1 1200,1090 A55,55 0 0 1 1200,1200 A55,55 0 0 0 1200,1310 Z`,fill:"#ffffff"});
E("circle",{cx:1200,cy:1145,r:15,fill:"#f0d98c"});
E("circle",{cx:1200,cy:1255,r:15,fill:"#ffffff"});

/* 2 先天八卦（逆） */
ring(2);circle(118);cells(8,118,165,22.5);
["乾","巽","坎","艮","坤","震","离","兑"].forEach((g,i)=>{const a=i*45,L=TR[g];
  for(let j=0;j<3;j++){const r=128+j*13;
    if(L[j])E("path",{d:arc(r,a-9,a+9),stroke:"#f0d98c","stroke-width":8,fill:"none"});
    else{E("path",{d:arc(r,a-9,a-3),stroke:"#f0d98c","stroke-width":8,fill:"none"});
         E("path",{d:arc(r,a+3,a+9),stroke:"#f0d98c","stroke-width":8,fill:"none"})}}});
circle(165);

/* 3 三才（顺） */
ring(3);cells(3,165,210,60);SANCAI.forEach(([t,a])=>horText(t,a,187,26));circle(210);
/* 4 四象（逆） */
ring(4);cells(4,210,252,45);SIXIANG.forEach(([t,a])=>horText(t,a,231,17));circle(252);
/* 5 五行（顺） */
ring(5);cells(5,252,290,36);WUXING.forEach((w,i)=>horText(w,i*72,271,20));circle(290);
/* 6 六道（逆） */
ring(6);cells(6,290,332,30);LIUDAO.forEach(([t,a])=>horText(t,a,311,15));circle(332);
/* 7 天罡（顺） */
ring(7);cells(36,332,374,5);TG.forEach((s,i)=>horText(s,i*10,353,16));circle(374);
/* 8 地煞（逆） */
ring(8);cells(72,374,414,2.5);DS.forEach((s,i)=>radialText(s,i*5,401.5,15,14));circle(414);
/* 9 九宫（顺） */
ring(9);cells(9,414,454,20);JIUGONG.forEach(([t,a])=>horText(t,a,434,15));circle(454);
/* 10 北斗九星（逆） */
ring(10);cells(9,454,494,20);BEIDOU.forEach((t,i)=>horText(t,i*40,474,15));circle(494);
/* 11 八十一数（顺） */
ring(11);cells(81,494,534,360/162);for(let i=0;i<81;i++)radialText(NUM9[i%9],i*360/81,514,0,18);circle(534);
/* 12 天干（逆） */
ring(12);cells(10,534,574,18);GAN.forEach((g,i)=>horText(g,i*36,554,20));circle(574);
/* 13 十二长生（顺） */
ring(13);cells(12,574,614,15);CHANGSHENG.forEach((s,i)=>horText(s,i*30,594,14));circle(614);
/* 14 节气（逆） */
ring(14);cells(24,614,654,7.5);TERMS.forEach((t,i)=>horText(t,i*15,634,14));circle(654);
/* 15 七十二候（顺） */
ring(15);cells(72,654,696,2.5);PHEN.forEach((s,i)=>tangText(s,i*5,675,9));circle(696);
/* 16 红黑半晕（逆） */
ring(16);
for(let i=0;i<24;i++){sector(696,716,i*15,i*15+7.5,"#b33");sector(696,716,i*15+7.5,i*15+15,"rgba(255,255,255,.28)")}
circle(696);circle(716);
/* 17 黄黑半晕（顺） */
ring(17);
for(let i=0;i<24;i++){sector(716,736,i*15,i*15+7.5,"#d9b22a");sector(716,736,i*15+7.5,i*15+15,"rgba(255,255,255,.28)")}
circle(736);
/* 18 二十四山（逆） */
ring(18);cells(24,736,780,7.5);M24.forEach((m,i)=>radialText(m,i*15,758,0,24));circle(780);
/* 19 六十甲子（顺） */
ring(19);cells(60,780,822,3);for(let i=0;i<60;i++)radialText(jiazi(i),i*6,808,14,13);circle(822);
/* 20 爻带（逆） */
ring(20);
{const w=5.625,rh=58/6;
 E("circle",{cx:C,cy:C,r:851,fill:"none",stroke:"rgba(13,20,40,.85)","stroke-width":58});
 for(let k=0;k<64;k++){const a0=k*w-w/2,L=hexLines(k);
  for(let i=0;i<6;i++){const r=822+i*rh+rh/2;
   if(L[i])E("path",{d:arc(r,a0+.5,a0+w-.5),stroke:"#f0d98c","stroke-width":rh*.62,fill:"none"});
   else{E("path",{d:arc(r,a0+.5,a0+w/2-.55),stroke:"#f0d98c","stroke-width":rh*.62,fill:"none"});
        E("path",{d:arc(r,a0+w/2+.55,a0+w-.5),stroke:"#f0d98c","stroke-width":rh*.62,fill:"none"})}}}}
circle(880);
/* 21 卦名（顺） */
ring(21);cells(64,880,928,-360/128);
for(let k=0;k<64;k++){const n=HEX[k];
  n.length===1?radialText(n,k*5.625,904,0,20):radialText(n,k*5.625,913,18,15)}
circle(928);
/* 22 二十八宿（逆） */
ring(22);
const tot=XIU.reduce((s,x)=>s+x[2],0), f=360/tot;
let before=0; for(let i=0;i<XIU.findIndex(x=>x[0]==="星");i++)before+=XIU[i][2]*f;
const off0=-(before+XIU.find(x=>x[0]==="星")[2]*f/2);
let cur=0;
for(const [n,ss,sp,el] of XIU){const s=cur*f+off0,a0=-s,a1=-(s+sp*f),m=(a0+a1)/2;
  const p0=pt(928,a0),p1=pt(966,a0);E("line",{x1:p0.x,y1:p0.y,x2:p1.x,y2:p1.y,stroke:"rgba(232,220,192,.75)","stroke-width":1});
  tangText(`${n}${ss}(${el})`,m,947,13);cur+=sp}
circle(966);
/* 23 度数（顺） */
ring(23);
for(let d=0;d<360;d++){const l=d%10===0?26:d%5===0?17:9,w=d%10===0?2.4:d%5===0?1.5:.9;
  const p0=pt(996-l,d),p1=pt(996,d);E("line",{x1:p0.x,y1:p0.y,x2:p1.x,y2:p1.y,stroke:"rgba(232,220,192,.75)","stroke-width":w})}
for(let a=0;a<360;a+=10)tangText(String((a+180)%360),a,1010,26,"deg");
circle(996,2);

/* 静止件：天池十字天心十道 */
P=svg;
E("line",{x1:C,y1:140,x2:C,y2:2260,stroke:"#e0655c","stroke-width":2,opacity:.5});
E("line",{x1:140,y1:C,x2:2260,y2:C,stroke:"#e0655c","stroke-width":2,opacity:.5});

/* ================= 四象角标:圆形罗盘外、方形 frame 的四角 =================
 * 方位(上南下北,左东右西):左上青龙(东)、右上朱雀(南)、右下白虎(西)、左下玄武(北)
 * 每角 = 圆形徽章(对应色描边)+ 简笔神兽 + 金色名字 */
const CORNERS=[
  {x:320,y:320,name:"青龙",color:"#3f9e6e",file:"img/sixiang/qinglong.svg"},
  {x:2080,y:320,name:"朱雀",color:"#d14a3f",file:"img/sixiang/zhuque.svg"},
  {x:2080,y:2080,name:"白虎",color:"#d8dbe2",file:"img/sixiang/baihu.svg"},
  {x:320,y:2080,name:"玄武",color:"#4a5c8a",file:"img/sixiang/xuanwu.svg"}
];
function cornerBadge(c){
  const g=E("g",{transform:`translate(${c.x},${c.y})`});
  /* 四象徽章:深色不透明底 + 对应色描边;图本身已改为 对应色→金 渐变(红金/青金/白金/玄金),无名字 */
  E("circle",{r:150,fill:"#0d1428",stroke:c.color,"stroke-width":3},g);
  E("image",{href:c.file,x:-150,y:-150,width:300,height:300},g);
}
CORNERS.forEach(cornerBadge);
}
  // IIFE 内暴露渲染函数(外部只拿到 window.__renderEvoChart)
  window.__renderEvoChart = function (svg) { renderEvoChart(svg); };
})();
