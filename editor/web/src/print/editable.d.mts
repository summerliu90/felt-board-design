import type {Document,Layer} from '../types'
import type {PrintPage} from './physical.mjs'
import type {PrintMaterial} from './exportPDF'
export function editablePrintCommands(doc:Document,materials:PrintMaterial[],pages:PrintPage[],prefix?:string):{commands:Record<string,unknown>[];mapping:Record<string,unknown>[]}
export function imageEditability(layer:Layer,u?:number):{label:string;low:boolean}
