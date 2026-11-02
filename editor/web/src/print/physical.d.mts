export const UNITS_PER_CM: number
export const PAPERS: Record<string, number[]>
export interface MaterialSize {id:string;widthCm:number;heightCm:number}
export interface Tile {id?:string;rotation?:0|90;row:number;column:number;pageWidthCm:number;pageHeightCm:number;sourceXcm:number;sourceYcm:number;widthCm:number;heightCm:number;targetXcm:number;targetYcm:number;scale:number}
export interface PrintPage {widthCm:number;heightCm:number;placements:(Tile & {id:string})[]}
export interface PrintOptions {allowRotation?:boolean;paper?:string;landscape?:boolean;marginCm?:number;overlapCm?:number;gapCm?:number}
export function physicalCanvas(w:number,h:number,u?:number):{width:number;height:number;physical:{widthCm:number;heightCm:number;unitsPerCm:number}}
export function effectiveDPI(pw:number,ph:number,w:number,h:number):number
export function transferPhysicalSize(layer:{width:number;height:number},source:number,target:number):{width:number;height:number}
export function tileMaterial(options:PrintOptions & {widthCm:number;heightCm:number}):{columns:number;rows:number;pages:Tile[]}
export function packMaterials(materials:MaterialSize[],options?:PrintOptions):PrintPage[]
export function validatePrintPages(pages:PrintPage[]):boolean
