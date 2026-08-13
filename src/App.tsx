import React, { useEffect, useRef, useState } from "react"
import { framer } from "@framer/plugin"

type AnyNode = any

type BinaryAsset = {
  mimeType: string
  data: string
  name: string
  altText?: string
}

type BackupNode = {
  type: string
  name: string
  attributes: Record<string, any>
  text?: string | null
  svg?: string | null
  backgroundImage?: BinaryAsset | null
  children: BackupNode[]
}

type BackupFile = {
  format: "framer-design-backup"
  version: 50
  createdAt: string
  sourceProject?: { name?: string; id?: string }
  mode: "selection" | "canvas"
  roots: BackupNode[]
}

const COMMON = [
  "name","visible","locked","width","height","minWidth","maxWidth","minHeight","maxHeight",
  "position","top","right","bottom","left","centerX","centerY","opacity","rotation","zIndex",
  "overflow","overflowX","overflowY","aspectRatio","link","linkOpenInNewTab","linkSmoothScroll",
  "linkTrackingId","linkClickTrackingId","linkRelValues","linkPreserveParams",
  "gridItemFillCellWidth","gridItemFillCellHeight","gridItemHorizontalAlignment","gridItemVerticalAlignment",
  "gridItemColumnSpan","gridItemRowSpan"
]
const FRAME = [
  ...COMMON,"backgroundColor","backgroundGradient","border","borderRadius","imageRendering",
  "layout","gap","padding","stackDirection","stackDistribution","stackAlignment","stackWrapEnabled",
  "gridColumnCount","gridRowCount","gridAlignment","gridColumnWidthType","gridColumnWidth","gridColumnMinWidth",
  "gridRowHeightType","gridRowHeight","isBreakpoint","isPrimaryBreakpoint"
]
const TEXT = [...COMMON,"font","inlineTextStyle","textTruncation","textAlign","textColor","fontSize","lineHeight","letterSpacing"]
const SVG = [...COMMON]

const pause = () => new Promise<void>(r => setTimeout(r, 0))

function safePrimitive(value: any, seen = new WeakSet<object>()): any {
  if (value == null) return value
  if (["string","number","boolean"].includes(typeof value)) return value
  if (typeof value === "function") return undefined
  if (Array.isArray(value)) return value.map(v => safePrimitive(v, seen)).filter(v => v !== undefined)
  if (typeof value === "object") {
    if (seen.has(value)) return undefined
    seen.add(value)
    const out: Record<string, any> = {}
    for (const key of Object.keys(value)) {
      if (["id","nodeId","parentId","apiVersion1Id"].includes(key)) continue
      try {
        const v = safePrimitive(value[key], seen)
        if (v !== undefined) out[key] = v
      } catch {}
    }
    return out
  }
  return undefined
}

function readAttributes(node: AnyNode, keys: string[]) {
  const out: Record<string, any> = {}
  for (const key of keys) {
    try {
      const v = node[key]
      if (v !== undefined && typeof v !== "function") out[key] = safePrimitive(v)
    } catch {}
  }
  return out
}

function bytesToBase64(bytes: Uint8Array) {
  let s = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(s)
}

function base64ToBytes(s: string) {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function withTimeout<T>(label: string, ms: number, work: Promise<T>): Promise<T> {
  let timer: number | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms/1000)}s`)), ms)
  })
  try { return await Promise.race([work, timeout]) as T }
  finally { if (timer) window.clearTimeout(timer) }
}

async function exportBackgroundImage(node: AnyNode): Promise<BinaryAsset | null> {
  try {
    const asset = node?.backgroundImage
    if (!asset || typeof asset.loadBitmap !== "function") return null
    const bitmap = await withTimeout("Reading image", 12000, asset.loadBitmap())
    const canvas = document.createElement("canvas")
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close?.()
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, "image/png"))
    if (!blob) return null
    const bytes = new Uint8Array(await blob.arrayBuffer())
    return { mimeType: "image/png", data: bytesToBase64(bytes), name: node?.name || "image", altText: asset?.altText || "" }
  } catch (e) {
    console.warn("Background image export skipped", node?.name, e)
    return null
  }
}

async function exportNode(node: AnyNode, onTick: () => void): Promise<BackupNode> {
  const type = String(node?.type || "FrameNode")
  let children: AnyNode[] = []
  try { children = await withTimeout("Reading children", 8000, node.getChildren()) } catch {}
  let text: string | null = null
  if (type === "TextNode" || type === "RichTextNode") {
    try { text = typeof node.getText === "function" ? await withTimeout("Reading text", 5000, node.getText()) : String(node.text ?? "") }
    catch { text = String(node.text ?? "") }
  }
  let svg: string | null = null
  if (type === "SVGNode") { try { svg = typeof node.svg === "string" ? node.svg : null } catch {} }
  const attrs = readAttributes(node, type.includes("Text") ? TEXT : type === "SVGNode" ? SVG : FRAME)
  const backgroundImage = await exportBackgroundImage(node)
  const result: BackupNode = { type, name: String(node?.name || "Layer"), attributes: attrs, text, svg, backgroundImage, children: [] }
  onTick()
  for (const child of children) {
    result.children.push(await exportNode(child, onTick))
    if (result.children.length % 20 === 0) await pause()
  }
  return result
}

function countNodes(nodes: BackupNode[]): number {
  return nodes.reduce((n, x) => n + 1 + countNodes(x.children || []), 0)
}

function downloadJSON(data: BackupFile) {
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `framer-backup-${new Date().toISOString().replace(/[:.]/g,"-")}.json`
  document.body.appendChild(a)
  a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

async function readJSON(file: File): Promise<BackupFile> {
  const text = await file.text()
  const data = JSON.parse(text)
  if (data?.format === "framer-design-backup" && Array.isArray(data.roots)) return data
  if (data?.type === "framer-design-backup" && Array.isArray(data.root)) {
    return { format:"framer-design-backup", version:50, createdAt:data.createdAt || new Date().toISOString(), mode:"selection", roots:data.root }
  }
  throw new Error("Invalid Framer backup JSON")
}

function cleanAttrs(attrs: Record<string, any>) {
  const out: Record<string, any> = {}
  const blocked = new Set(["id","type","nodeId","parentId","componentIdentifier","componentName","text","backgroundImage","isReplica"])
  for (const [k,v] of Object.entries(attrs || {})) if (!blocked.has(k) && v !== undefined) out[k] = v
  return out
}

async function uploadImage(asset: BinaryAsset) {
  return await withTimeout("Uploading image", 15000, (framer as any).uploadImage({
    image: { bytes: base64ToBytes(asset.data), mimeType: asset.mimeType },
    name: asset.name,
    altText: asset.altText || ""
  }))
}

function parseCssNumber(v: any, fallback: number) {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string") {
    const m = v.match(/-?[\d.]+/)
    if (m) return Number(m[0])
  }
  return fallback
}

async function textToPng(node: BackupNode): Promise<BinaryAsset | null> {
  try {
    const a = node.attributes || {}
    const text = node.text || ""
    const width = Math.max(1, Math.ceil(parseCssNumber(a.width, 300)))
    const height = Math.max(1, Math.ceil(parseCssNumber(a.height, 80)))
    const scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
    const canvas = document.createElement("canvas")
    canvas.width = Math.min(4096, Math.ceil(width * scale))
    canvas.height = Math.min(4096, Math.ceil(height * scale))
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    ctx.scale(scale, scale)
    ctx.clearRect(0,0,width,height)
    const fontSize = parseCssNumber(a.fontSize ?? a.inlineTextStyle?.fontSize, 16)
    const family = a.font?.family || a.inlineTextStyle?.font?.family || "Arial"
    const weight = a.font?.weight || a.inlineTextStyle?.font?.weight || 400
    ctx.font = `${weight} ${fontSize}px ${JSON.stringify(family)}`
    ctx.fillStyle = a.textColor || a.inlineTextStyle?.color || "#111111"
    ctx.textBaseline = "top"
    const lineHeight = parseCssNumber(a.lineHeight ?? a.inlineTextStyle?.lineHeight, Math.round(fontSize * 1.2))
    const lines = String(text).split("\n")
    let y = 0
    for (const line of lines) {
      ctx.fillText(line, 0, y, width)
      y += lineHeight
      if (y > height) break
    }
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, "image/png"))
    if (!blob) return null
    return { mimeType:"image/png", data:bytesToBase64(new Uint8Array(await blob.arrayBuffer())), name:`${node.name}-text.png`, altText:text.slice(0,200) }
  } catch { return null }
}

type ImportCtx = {
  done: number
  total: number
  failed: number
  cancelled: boolean
  onProgress: (done:number,total:number,failed:number,label:string)=>void
}

async function makeFrame(node: BackupNode, parentId: string | undefined, ctx: ImportCtx) {
  const attrs = cleanAttrs(node.attributes)
  delete attrs.x; delete attrs.y
  let imageAsset: any = null
  if (node.backgroundImage) {
    try { imageAsset = await uploadImage(node.backgroundImage) } catch (e) { console.warn("Image skipped", node.name, e) }
  }
  // SAFE MODE: never call addText/addSVG. Those insertion APIs are the source of the endless Framer operation UI on large imports.
  // Text/SVG are restored as visual frame assets, so the import always terminates.
  if ((node.type === "TextNode" || node.type === "RichTextNode") && !imageAsset) {
    const png = await textToPng(node)
    if (png) try { imageAsset = await uploadImage(png) } catch {}
  }
  if (imageAsset) attrs.backgroundImage = imageAsset
  if (node.type === "SVGNode" && node.svg && !imageAsset) {
    try {
      const svgBytes = new TextEncoder().encode(node.svg)
      imageAsset = await uploadImage({ mimeType:"image/svg+xml", data:bytesToBase64(svgBytes), name:`${node.name}.svg` })
      attrs.backgroundImage = imageAsset
    } catch (e) { console.warn("SVG skipped", node.name, e) }
  }
  const created: any = await withTimeout(`Creating ${node.name}`, 12000, (framer as any).createFrameNode(attrs, parentId))
  if (!created?.id) throw new Error(`No node returned for ${node.name}`)
  return created
}

async function restoreNode(node: BackupNode, parentId: string | undefined, ctx: ImportCtx): Promise<any | null> {
  if (ctx.cancelled) throw new Error("Import cancelled")
  let created: any = null
  try {
    created = await makeFrame(node, parentId, ctx)
  } catch (e) {
    ctx.failed++
    console.error("Layer failed", node.name, node.type, e)
  }
  ctx.done++
  ctx.onProgress(ctx.done, ctx.total, ctx.failed, node.name)
  if (ctx.done % 10 === 0) await pause()
  const nextParent = created?.id || parentId
  for (const child of node.children || []) {
    await restoreNode(child, nextParent, ctx)
  }
  return created
}

export default function App() {
  const [selectionCount, setSelectionCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState("Ready")
  const [progress, setProgress] = useState(0)
  const cancelRef = useRef(false)

  useEffect(() => {
    let unsub: undefined | (()=>void)
    ;(async()=>{
      const s = await framer.getSelection(); setSelectionCount(s.length)
      unsub = framer.subscribeToSelection(s => setSelectionCount(s.length))
    })()
    return ()=>unsub?.()
  },[])

  const runExport = async (mode:"selection"|"canvas") => {
    setBusy(true); setProgress(0); setStatus("Reading layers…")
    try {
      let roots: AnyNode[] = []
      if (mode === "selection") roots = await framer.getSelection()
      else {
        const canvas: any = await framer.getCanvasRoot()
        roots = await canvas.getChildren()
      }
      if (!roots.length) throw new Error(mode === "selection" ? "Select at least one parent layer." : "Current canvas is empty.")
      let done = 0
      const tick = () => { done++; setStatus(`Exporting… ${done} layers read`) }
      const output: BackupNode[] = []
      for (const r of roots) output.push(await exportNode(r, tick))
      const info: any = await (framer as any).getProjectInfo?.().catch?.(()=>null)
      const data: BackupFile = { format:"framer-design-backup", version:50, createdAt:new Date().toISOString(), mode, sourceProject:info ? {name:info.name,id:info.id}:undefined, roots:output }
      downloadJSON(data)
      setProgress(100); setStatus(`Export complete ✓\n${countNodes(output)} layers saved.`)
    } catch (e:any) { console.error(e); setStatus(`Export failed: ${e?.message || e}`) }
    finally { setBusy(false) }
  }

  const chooseImport = () => {
    const input = document.createElement("input")
    input.type="file"; input.accept=".json,application/json"
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return
      setBusy(true); setProgress(0); cancelRef.current=false
      try {
        const data = await readJSON(file)
        const total = countNodes(data.roots)
        if (!total) throw new Error("Backup contains no layers.")
        setStatus(`Importing 0/${total}…`)
        const canvas:any = await framer.getCanvasRoot()
        const ctx: ImportCtx = {
          done:0,total,failed:0,cancelled:false,
          onProgress:(done,total,failed,label)=>{
            ctx.cancelled = cancelRef.current
            setProgress(Math.round(done/total*100))
            setStatus(`Importing ${done}/${total}\nCurrent: ${label}${failed ? `\nSkipped: ${failed}`:""}`)
          }
        }
        const created:any[] = []
        for (const root of data.roots) {
          const n = await restoreNode(root, canvas?.id, ctx)
          if (n) created.push(n)
        }
        if (created.length) {
          try { await framer.setSelection(created.map(n=>n.id)) } catch {}
          try { await framer.zoomIntoView(created.map(n=>n.id)) } catch {}
        }
        setProgress(100)
        setStatus(`Import complete ✓\n${ctx.done-ctx.failed}/${ctx.total} layers created.${ctx.failed ? `\n${ctx.failed} unsupported/failed layers skipped.`:""}`)
      } catch (e:any) {
        const msg = e?.message || String(e)
        setStatus(msg === "Import cancelled" ? "Import cancelled." : `Import stopped: ${msg}`)
      } finally { setBusy(false) }
    }
    input.click()
  }

  return <main className="app">
    <h1 className="title">Framer Design Backup V5</h1>
    <div className="sub">Rebuilt from scratch • safe import engine</div>

    <div className="grid">
      <button className="btn primary" disabled={busy || !selectionCount} onClick={()=>runExport("selection")}>Export Selection</button>
      <button className="btn secondary" disabled={busy} onClick={()=>runExport("canvas")}>Export Canvas</button>
      <button className="btn primary" disabled={busy} onClick={chooseImport}>Import Backup</button>
      <button className="btn secondary" disabled={!busy} onClick={()=>{cancelRef.current=true;setStatus("Cancelling after current layer…")}}>Cancel</button>
    </div>

    <div className="status">
      {selectionCount} selected\n{status}
      <div className="progress"><div className="bar" style={{width:`${progress}%`}} /></div>
    </div>

    <div className="info">
      <b>Important:</b> this build intentionally does not use Framer’s <code>addText()</code> / <code>addSVG()</code> insertion calls during bulk import. Text and SVG layers are restored as visual image-backed frames. This prevents the endless Framer “Development… Cancel” operation shown in your screenshots. Frames, layout, sizes, positioning, colors, borders, nested hierarchy and background images remain editable where Framer exposes those properties.
    </div>
  </main>
}
