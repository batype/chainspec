import { useEffect, useMemo, useRef, useState } from "react";
import { zipSync, strToU8 } from "fflate";
import type { GeneratedProject, GeneratorOptions, SDKTarget } from "./core/model";
import { SDK_TARGETS, selectSDKTarget } from "./core/targets";
import { MAX_BYTES } from "./core/model";
import { exampleText } from "./example";
import Workspace from "./components/Workspace";
import Guide from "./components/Guide";
import { generationKey, configFieldErrors, exportWorkspace, importWorkspace, type DocumentInfo } from "./editor-state";
import SourceDialog from "./components/SourceDialog";
import { sourceRequestOptions, type SourceRequestConfig } from "./core/source-config";
import { DEFAULT_CONFIG, parseConfig, parseControllerNames, TRANSLATION_DEFAULTS, type ChainSpecConfig } from "./core/config";
import { fetchDocument } from "./core/source";
const namesCacheKey = "chainspec-controller-names-v1";
function cachedConfig() {
  try { return { ...DEFAULT_CONFIG, target: "react" as const, controllerNames: parseControllerNames(JSON.parse(localStorage.getItem(namesCacheKey) ?? "{}")) }; }
  catch { return { ...DEFAULT_CONFIG, target: "react" as const }; }
}
const defaultConfigText = JSON.stringify(cachedConfig(), null, 2);
type SourceLabel = {kind:"example"|"edited"|"file"|"url";name:string};
type UndoState = { input:string;configText:string;result:GeneratedProject|null;submitted:string;generatedInput:string;source:SourceLabel };
type Theme = "system" | "light" | "dark";
function download(
  bytes: BlobPart,
  name: string,
  type = "text/plain;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function readTheme(): Theme {
  try {
    const t = localStorage.getItem("chainspec-theme");
    return t === "dark" || t === "light" ? t : "system";
  } catch {
    return "system";
  }
}
export default function App() {
  const [input, setInput] = useState(exampleText),
    [configText, setConfigText] = useState(defaultConfigText),
    [sourceOpen, setSourceOpen] = useState(false),
    [loadingUrl, setLoadingUrl] = useState(false),
    [mappingText, setMappingText] = useState(""),
    [result, setResult] = useState<GeneratedProject | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [submitted, setSubmitted] = useState(""),
    [route, setRoute] = useState(window.location.hash),
    [generatedInput, setGeneratedInput] = useState(""),
    [theme, setTheme] = useState<Theme>(readTheme),
    [inputOpen, setInputOpen] = useState(true),
    [sourceLabel,setSourceLabel] = useState<SourceLabel>({kind:"example",name:"内置示例"}),
    [documentInfo,setDocumentInfo] = useState<{info?:DocumentInfo;error?:string;pending?:boolean}>({pending:true}),
    [undo,setUndo] = useState<UndoState|null>(null),
    [configImported,setConfigImported] = useState(false),
    [savedWork,setSavedWork] = useState<{input:string;configText:string}|null>(null);
  const inspectionSeq=useRef(0), fileInput=useRef<HTMLInputElement>(null), workspaceInput=useRef<HTMLInputElement>(null);
  const worker = useRef<Worker | null>(null),
    seq = useRef(0),
    editor = useRef<HTMLTextAreaElement>(null),
    configDialog = useRef<HTMLDialogElement>(null),
    edits = useRef(0),
    imports = useRef(0),
    remote = useRef<AbortController | null>(null),
    pendingGeneration = useRef({ id: 0, input: exampleText, configText: defaultConfigText }),
    currentState = useRef({ input, configText });
  currentState.current = { input, configText };
  const cancelGeneration = () => {
    seq.current++;
    worker.current?.postMessage({ action: "cancel" });
    setBusy(false);
    setNotice("本次生成已取消。");
  };
  const parsedConfig = useMemo(() => {
    try {
      const value = parseConfig(configText);
      const fields=configFieldErrors(value);if(Object.keys(fields).length)throw new Error(Object.values(fields)[0]);
      if (Object.keys(value.controllerNames ?? {}).some((tag) => !tag.trim()))
        throw new Error("请填写映射的原分组名称");
      return { value, error: "" };
    }
    catch (e) { return { value: null, error: e instanceof Error ? e.message : "配置有误" }; }
  }, [configText]);
  // Keep draft field values visible even while validation reports an error.
  const settings = useMemo(() => JSON.parse(configText) as ChainSpecConfig, [configText]);
  const updateConfig = (patch: Partial<ChainSpecConfig>) => {
    setUndo(null);
    if (busy && Object.keys(patch).some(key => !["target","hooks","output"].includes(key))) cancelGeneration();
    setConfigText((previous) => JSON.stringify({ ...JSON.parse(previous), ...patch }, null, 2));
    setError("");
    setNotice("");
  };
  const translation = { ...TRANSLATION_DEFAULTS[settings.translation?.provider ?? "mymemory"], ...settings.translation };
  const updateTranslation = (patch: Partial<typeof translation>) => updateConfig({ translation: { ...translation, ...patch } });
  const fieldErrors = configFieldErrors(settings);
  const focusConfigError = () => {
    const node=document.querySelector<HTMLInputElement>('.settings-panel [aria-invalid="true"]');
    if(node){ for(let parent:HTMLElement|null=node.parentElement;parent;parent=parent.parentElement)if(parent instanceof HTMLDetailsElement)parent.open=true;node.focus();node.scrollIntoView({block:"center"}); }
    else document.getElementById("config-error")?.scrollIntoView({block:"center"});
  };
  const fieldAttrs = (id:string) => ({id,name:id,autoComplete:"off","aria-invalid":Boolean(fieldErrors[id]),"aria-describedby":fieldErrors[id]?`${id}-error`:undefined});
  const fieldMessage=(id:string)=>fieldErrors[id]?<small className="field-error" id={`${id}-error`}>{fieldErrors[id]}</small>:null;
  const mappings = Object.entries(settings.controllerNames ?? {});
  const updateMapping = (index: number, tag: string, name: string) => {
    if (mappings.some(([key], i) => i !== index && key === tag)) {
      setError("原分组名称重复，请为每个 Tag 只配置一条映射。");
      return;
    }
    updateConfig({ controllerNames: Object.fromEntries(mappings.map((entry, i) => i === index ? [tag, name] : entry)) });
  };
  const applyMappingText = () => {
    try {
      let value: unknown;
      if (mappingText.trim().startsWith("{")) {
        const parsed = JSON.parse(mappingText);
        value = Object.hasOwn(parsed, "controllerNames") ? parsed.controllerNames : parsed;
      } else {
        const entries = mappingText.split("\n").filter(line => line.trim()).map(line => {
          const pos = line.indexOf("=");
          if (pos < 1) throw new Error("粘贴 JSON 映射，或每行填写 原分组=英文名称");
          return [line.slice(0, pos).trim(), line.slice(pos + 1).trim()];
        });
        if (new Set(entries.map(([tag]) => tag)).size !== entries.length) throw new Error("粘贴内容有重复分组");
        value = Object.fromEntries(entries);
      }
      const names = parseControllerNames(value);
      updateConfig({ controllerNames: { ...settings.controllerNames, ...names } });
      setMappingText("");
      setNotice(`已合并 ${Object.keys(names).length} 条映射，已有同名分组以粘贴值为准。`);
    } catch (e) { setError(e instanceof Error ? e.message : "映射格式有误"); }
  };
  const copyMappings = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(parseControllerNames(settings.controllerNames ?? {}), null, 2));
      setNotice("分组映射已复制，可粘贴到其他工程。");
    } catch { setNotice("复制失败，请手动复制配置中的 controllerNames。"); }
  };
  const copyConfig = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(parseConfig(configText), null, 2));
      setNotice("JSON 配置已复制，可用于 CLI。");
    } catch { setNotice("复制失败，请导出配置文件或手动复制。"); }
  };
  const target = settings.target ?? "all";
  const visibleResult = useMemo(() => result ? selectSDKTarget(result, target, { hooks: settings.hooks !== false }) : null, [result, target, settings.hooks]);
  const changeTarget = (value: SDKTarget) => updateConfig({ target: value, hooks: value !== "node" && value !== "browser" });
  const stateKey = useMemo(()=>generationKey(input, configText),[input,configText]);
  const dirty = stateKey !== submitted;
  const ready = Boolean(result) && !dirty && !busy && !error && !parsedConfig.error;
  const options = (): GeneratorOptions => {
    const { version, input, output, sourceRequest, ...opts } = parseConfig(configText);
    // Keep a complete local result so switching output targets never refetches or retranslates the spec.
    return { ...opts, target: "all", hooks: true };
  };
  const setSource = (source: string) => setConfigText((previous) => {
    try { return JSON.stringify({ ...parseConfig(previous), input: source }, null, 2); }
    catch { return previous; }
  });
  const saveConnection = (url: string, request: SourceRequestConfig) => {
    updateConfig({ input: url, sourceRequest: request });
    setNotice("连接设置已保存，配置只包含环境变量名；下次获取时请填写本次凭据。");
  };
  const closeConnection = () => {
    imports.current++;
    remote.current?.abort();
    setLoadingUrl(false);
    setSourceOpen(false);
  };
  const importUrl = async (url: string, request: SourceRequestConfig, values: Record<string, string>) => {
    const requestOptions = sourceRequestOptions(request, values);
    if (busy) cancelGeneration();
    const edit = edits.current, id = ++imports.current;
    remote.current?.abort();
    const controller = new AbortController();
    remote.current = controller;
    setLoadingUrl(true);
    setError("");
    setNotice("");
    try {
      const text = await fetchDocument(url, controller.signal, requestOptions);
      if (edit !== edits.current || id !== imports.current) return false;
      edits.current++;
      setInput(text);
      setSourceLabel({kind:"url",name:url});
      setConfigImported(false);
      updateConfig({ input: url, sourceRequest: request });
      setInputOpen(true);
      setNotice("JSON 已载入，点击生成 SDK。连接配置已保存，真实凭据未保存。");
      return true;
    } catch (e) {
      if (id !== imports.current || edit !== edits.current) return false;
      const message = e instanceof Error ? e.message : "获取失败";
      setError(message);
      throw new Error(message);
    } finally {
      if (id === imports.current) setLoadingUrl(false);
    }
  };
  const exportConfig = () => {
    try { download(JSON.stringify(parseConfig(configText), null, 2), "chainspec.config.json", "application/json"); }
    catch (e) { setError(e instanceof Error ? e.message : "配置有误"); }
  };
  const importConfig = async (file: File | undefined) => {
    if (!file) return;
    if (busy) cancelGeneration();
    try {
      if (file.size > MAX_BYTES) throw new Error("配置最大 8 MiB");
      const config = parseConfig(await file.text());
      setUndo(null);
      setConfigImported(true);
      setConfigText(JSON.stringify(config, null, 2));
      setNotice("配置已导入；URL 来源请打开连接设置获取，本地来源请另行导入 JSON 文件。");
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "配置有误"); }
  };
  const generate = () => {
    try {
      const opts = options();
      if (new TextEncoder().encode(input).length > MAX_BYTES)
        throw new Error("输入最大8 MiB");
      const id = ++seq.current;
      pendingGeneration.current = { id, input, configText };
      setBusy(true);
      setError("");
      setNotice("");
      setSubmitted(stateKey);
      worker.current?.postMessage({ id, input, options: opts });
    } catch (e) {
      if(parsedConfig.error){setError("");setNotice("请补全标出的配置项后再生成。");focusConfigError();}
      else{setError(e instanceof Error ? e.message : "生成失败");editor.current?.focus();}
    }
  };
  useEffect(() => {
    const w = new Worker(
      new URL("./workers/generate.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.current = w;
    w.onmessage = ({
      data,
    }: MessageEvent<{
      id: number;
      result?: GeneratedProject;
      error?: string;
      progress?: { current: number; total: number };
      kind?:string;info?:DocumentInfo;inspectionError?:string;
    }>) => {
      if(data.kind==="inspection"){if(data.id===inspectionSeq.current)setDocumentInfo({info:data.info,error:data.inspectionError});return;}
      if (data.id !== seq.current) return;
      if (data.progress) {
        setNotice(`正在翻译缺失分组 ${data.progress.current} / ${data.progress.total}，已有映射直接复用…`);
        return;
      }
      if (data.result) {
        const sent = pendingGeneration.current;
        if (sent.id === data.id && currentState.current.input === sent.input && generationKey(currentState.current.input, currentState.current.configText) === generationKey(sent.input, sent.configText)) {
          const next = JSON.stringify({ ...JSON.parse(currentState.current.configText), controllerNames: data.result.controllerNames }, null, 2);
          setConfigText(next);
          setSubmitted(generationKey(sent.input, next));
          try { localStorage.setItem(namesCacheKey, JSON.stringify(data.result.controllerNames)); } catch {}
        }
        const failed = data.result.diagnostics.some(d => d.code.startsWith("translation-"));
        setNotice(failed ? "SDK 已生成，部分翻译未成功，已回退路径命名；成功结果已缓存，请查看诊断。" : "SDK 已生成。英文分组映射已缓存，可复制、下载或用于下次生成。");
      } else setNotice("");
      setBusy(false);
      setError(data.error ?? "");
      setResult(data.result ?? null);
      if (data.result) {
        setGeneratedInput(pendingGeneration.current.input);
        window.location.hash = "/workspace";
      }
      if (data.error) editor.current?.focus();
    };
    w.onerror = () => {
      setBusy(false);
      setResult(null);
      setError("本地生成线程发生错误，请刷新后重试。");
    };
    return () => { w.terminate(); remote.current?.abort(); };
  }, []);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "dark" || (theme === "system" && media.matches)
          ? "dark"
          : "light";
    };
    apply();
    try {
      localStorage.setItem("chainspec-theme", theme);
    } catch {}
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(()=>{
    const id=++inspectionSeq.current;
    if(!input.trim()){setDocumentInfo({});return;}
    setDocumentInfo({pending:true});
    const timer=setTimeout(()=>worker.current?.postMessage({action:"inspect",id,input}),250);
    return()=>clearTimeout(timer);
  },[input]);
  useEffect(()=>{if(!undo)return;const timer=setTimeout(()=>setUndo(null),12000);return()=>clearTimeout(timer);},[undo]);
  useEffect(()=>{
    if(!input.trim()||(sourceLabel.kind==="example"&&configText===defaultConfigText)||(savedWork?.input===input&&savedWork?.configText===configText))return;
    const beforeUnload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
    window.addEventListener("beforeunload",beforeUnload);return()=>window.removeEventListener("beforeunload",beforeUnload);
  },[input,sourceLabel.kind,configText,savedWork]);
  const workspace = route.startsWith("#/workspace");
  const guide = route.startsWith("#/guide") || route === "#guide";
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    document.title = guide ? "接入指南 · ChainSpec" : workspace ? "SDK 工作台 · ChainSpec" : "ChainSpec · 配置与生成";
    window.scrollTo(0, 0);
    if (workspace || guide) document.getElementById(guide ? "guide-title" : "workspace-title")?.focus({ preventScroll: true });
  }, [workspace, guide]);
  useEffect(() => {
    if (["#studio", "#top"].includes(route)) document.getElementById(route.slice(1))?.scrollIntoView();
  }, [route]);
  const clear = () => {
    if(input.trim()||result)setUndo({input,configText,result,submitted:busy?"":submitted,generatedInput,source:sourceLabel});
    edits.current++;
    imports.current++;
    remote.current?.abort();
    setLoadingUrl(false);
    seq.current++;
    worker.current?.postMessage({ action: "cancel" });
    setInput("");
    setSourceLabel({kind:"edited",name:"尚未导入文档"});
    setResult(null);
    setError("");
    setBusy(false);
    setNotice("当前输入与生成结果已清空。");
    setInputOpen(true);
  };
  const restoreClear = () => {
    if(!undo)return;
    seq.current++;imports.current++;remote.current?.abort();worker.current?.postMessage({action:"cancel"});
    setBusy(false);setLoadingUrl(false);setInput(undo.input);setConfigText(undo.configText);setResult(undo.result);setSubmitted(undo.submitted);setGeneratedInput(undo.generatedInput);setSourceLabel(undo.source);setError("");setUndo(null);setNotice("已恢复清空前的文档、配置与生成结果。");
  };
  const sample = () => {
    if (
      input.trim() &&
      input !== exampleText &&
      !confirm("载入示例会替换当前JSON，是否继续？")
    )
      return;
    edits.current++;
    setUndo(null);
    setSourceLabel({kind:"example",name:"内置示例"});
    setConfigImported(false);
    setInput(exampleText);
    setSource("./openapi.json");
    setError("");
    setNotice("合成示例已载入，点击生成。");
    setInputOpen(true);
  };
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    if (busy) cancelGeneration();
    const edit = edits.current,
      id = ++imports.current;
    remote.current?.abort();
    setLoadingUrl(false);
    try {
      if (file.size > MAX_BYTES) throw new Error("文件最大8 MiB");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer(),
      );
      if (edit !== edits.current || id !== imports.current) return;
      edits.current++;
      setUndo(null);
      setInput(text);
      setSourceLabel({kind:"file",name:file.name});
      setConfigImported(false);
      setSource(file.name);
      setError("");
      setNotice("文件已在本地读入，点击生成SDK。");
      setInputOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "文件需为UTF-8 JSON");
    }
  };
  const saveWork = () => {
    try{download(exportWorkspace(input,JSON.parse(configText)),"chainspec-workspace.json","application/json");setSavedWork({input,configText});setNotice("工作包已下载，包含接口文档和生成配置。请在本机妥善保存。");}
    catch(e){setNotice(e instanceof Error?e.message:"无法保存工作包");if(parsedConfig.error)focusConfigError();}
  };
  const restoreWork = async (file:File|undefined) => {
    if(!file)return;
    try{
      if(file.size>32*1024*1024)throw Error("工作包最大 32 MiB");
      const value=importWorkspace(await file.text()),next=JSON.stringify(value.config,null,2);
      edits.current++;imports.current++;seq.current++;worker.current?.postMessage({action:"cancel"});remote.current?.abort();
      setBusy(false);setLoadingUrl(false);setInput(value.document);setConfigText(next);setResult(null);setSubmitted("");setGeneratedInput("");setSourceLabel({kind:"file",name:`工作包：${file.name}`});setConfigImported(false);setUndo(null);setSavedWork({input:value.document,configText:next});setError("");setInputOpen(true);setNotice("工作包已恢复。点击生成即可重建 SDK。连接弹窗中的账号、Token 不会保存进工作包。");
    }catch(e){setNotice(e instanceof Error?e.message:"工作包导入失败");}
  };
  const exportZip = () => {
    if (!ready || !visibleResult) return;
    const entries = Object.fromEntries(Object.entries(visibleResult.files).map(([name, text]) => [`sdk/${name}`, strToU8(text)]));
    entries["chainspec.config.json"] = strToU8(JSON.stringify({ ...parseConfig(configText), target, hooks: Boolean(visibleResult.files["react.ts"]) }, null, 2));
    entries["controller-names.json"] = strToU8(JSON.stringify(visibleResult.controllerNames, null, 2));
    download(zipSync(entries, { level: 6 }).slice().buffer, `chainspec-sdk-${target}.zip`, "application/zip");
    setNotice(`${SDK_TARGETS.find(item => item.value === target)?.label} SDK 已下载。`);
  };
  return (
    <>
      <a className="skip" href={guide ? "#guide-page" : workspace ? "#workspace" : "#studio"} onClick={e => {
        e.preventDefault();
        const target = document.getElementById(guide ? "guide-title" : workspace ? "workspace-title" : "studio");
        target?.focus(); target?.scrollIntoView();
      }}>
        跳到主要内容
      </a>
                      <input
                        id="document-file" hidden aria-label="导入 OpenAPI JSON 文件" ref={fileInput}
                        type="file"
                        accept=".json,.txt,application/json,text/plain"
                        onChange={(e) => {
                          void importFile(e.target.files?.[0]);
                          e.target.value = "";
                        }}
                      />
      <input id="workspace-file" ref={workspaceInput} hidden aria-label="恢复 ChainSpec 工作包" type="file" accept=".json,application/json" onChange={e=>{void restoreWork(e.target.files?.[0]);e.target.value="";}}/>
      <header className="topbar">
        <a className="brand" href="#/configure">
          <img
            src={`${import.meta.env.BASE_URL}icon.svg`}
            alt=""
            width="34"
            height="34"
          />
          <strong>ChainSpec</strong>
          <span>从接口到调用</span>
        </a>
        <nav aria-label="主导航">
          <a href="#/configure" aria-current={!workspace && !guide ? "page" : undefined}>配置与生成</a>
          <a href="#/workspace" aria-current={workspace ? "page" : undefined}>SDK 工作台</a>
          <a href="#/guide" aria-current={guide ? "page" : undefined}>接入指南</a>
          <a
            href="https://github.com/batype/chainspec"
            target="_blank"
            rel="noreferrer"
          >
            GitHub ↗
          </a>
        </nav>
        <label className="sr-only" htmlFor="theme">
          界面主题
        </label>
        <select
          id="theme"
          value={theme}
          onChange={(e) => setTheme(e.target.value as Theme)}
        >
          <option value="system">跟随系统</option>
          <option value="light">亮色模式</option>
          <option value="dark">暗色模式</option>
        </select>
      </header>
      <dialog ref={configDialog} className="config-dialog" aria-labelledby="config-dialog-title">
        <div className="config-dialog-heading">
          <div><h2 id="config-dialog-title">JSON 配置</h2><p>与当前表单同步，可用于网页或 CLI。</p></div>
          <button type="button" onClick={() => configDialog.current?.close()} aria-label="关闭配置">×</button>
        </div>
        <pre className="config-json-preview" tabIndex={0} aria-label="当前 JSON 配置">{configText}</pre>
        {parsedConfig.error && <p className="config-error">{parsedConfig.error}</p>}
        <div className="config-dialog-actions">
          <button type="button" onClick={() => void copyConfig()} disabled={Boolean(parsedConfig.error)}>复制 JSON</button>
          <button type="button" className="primary" onClick={exportConfig} disabled={Boolean(parsedConfig.error)}>↓ 导出配置</button>
        </div>
      </dialog>
      {sourceOpen && <SourceDialog input={settings.input} request={settings.sourceRequest} loading={loadingUrl}
        onLoad={importUrl} onSave={saveConnection} onClose={closeConnection} />}
      {guide ? <Guide route={route} defaultTarget={target} /> : workspace ? visibleResult ? <Workspace output={settings.output} source={settings.input} demo={generatedInput===exampleText} onConfig={exportConfig} project={visibleResult} target={target} onTargetChange={changeTarget} documentText={generatedInput} route={route} ready={ready} onDownload={exportZip} /> : <main className="workspace-page workspace-empty" id="workspace"><span className="eyebrow">SDK WORKSPACE</span><h1 id="workspace-title" tabIndex={-1}>先生成，再体验。</h1><p>生成结果只保留在当前页面内存中。导入你的文档，或用内置示例生成一个 SDK。</p><a className="primary button-link" href="#/configure">前往配置与生成 →</a></main> : <main id="top">
        <section className="hero">
          <div>
            <div className="eyebrow">
              <span className="pulse" /> OPENAPI → TYPESCRIPT SDK{" "}
              <span className="badge">LOCAL FIRST</span>
            </div>
            <h1>
              从一份规范，
              <br />
              到每一次<span>调用。</span>
            </h1>
            <p>
              导入 Swagger JSON，把接口变成有类型的链式 SDK。
              <br />
              请求由你掌控，React 交给 SWR。
            </p>
            <div className="hero-actions"><a className="primary button-link" href="#studio">开始配置 →</a><button type="button" disabled={busy || loadingUrl || !input.trim()} onClick={generate}>生成并进入工作台 ↗</button></div>
            <div className="hero-tags">
              <span>TypeScript 补全</span>
              <span>自定义请求与拦截器</span>
              <span>纯本地生成</span>
            </div>
          </div>
          <div className="chain-card" aria-label="链式调用示例">
            <div>
              <span className="small-caps">ONE CONTRACT. ONE CHAIN.</span>
              <span className="chain-icon">↳</span>
            </div>
            <p>
              <b>API</b>
              <em>.main</em>
              <span>.users</span>
              <span>.getUser</span>
            </p>
            <div className="chain-branches">
              <span>
                ↳ <strong>.request</strong>({"{ path }"}){" "}
                <small>Promise&lt;User&gt;</small>
              </span>
              <span>
                ↳ <strong>.useRequest</strong>({"{ path }"}){" "}
                <small>SWRResponse&lt;User&gt;</small>
              </span>
            </div>
            <footer>
              <i /> 类型跟着接口走，调用不再凭记忆。
            </footer>
          </div>
        </section>
        <section className="studio" id="studio" tabIndex={-1} aria-label="SDK生成器">
          <div className="studio-toolbar">
            <div>
              <span className="step">01</span>
              <h2>配置与生成</h2>
              <span className="local-label">◉ JSON 留在当前页面</span>
            </div>
            <div>
              <button type="button" className="text-button" onClick={sample}>
                载入示例
              </button>
              <button
                type="button"
                onClick={() => setInputOpen((v) => !v)}
                aria-expanded={inputOpen}
              >
                {inputOpen ? "收起输入 ↑" : "编辑输入 ↓"}
              </button>
              {busy && <button type="button" onClick={cancelGeneration}>取消生成</button>}
              <button
                type="button"
                className="primary"
                onClick={generate}
                disabled={busy || loadingUrl || !input.trim()}
              >
                {busy ? "正在生成…" : "生成并进入工作台"} <span>↗</span>
              </button>
            </div>
          </div>
          <div className={`source-summary ${sourceLabel.kind==="example"?"is-example":""}`} aria-label="当前文档来源">
            <span className="source-kind">{sourceLabel.kind==="example"?"演示文档":"当前文档"}</span><strong>{sourceLabel.name}</strong>
            {sourceLabel.kind==="example"&&<span>还没有导入你的接口；可直接体验，或导入自己的 JSON。</span>}
            {documentInfo.pending?<span>正在本地识别…</span>:documentInfo.info?<><span>{documentInfo.info.title} · {documentInfo.info.operations} 个接口 · {documentInfo.info.schemaCount} 个模型</span><span>当前业务地址：<code>{(settings.baseUrl??documentInfo.info.baseUrl)||"相对路径（Node 需配置绝对地址）"}</code>{settings.baseUrl?"（手动覆盖）":"（来自文档）"}</span></>:documentInfo.error?<span className="field-error">{documentInfo.error}</span>:null}
          </div>
          <div className="workspace-backup"><span>文档仅在当前标签页；刷新前可下载工作包，之后本地恢复。工作包含业务 JSON，请勿公开提交。</span><button type="button" disabled={!input.trim()} onClick={saveWork}>保存工作包</button><button type="button" className="import-file" onClick={()=>workspaceInput.current?.click()}>恢复工作包</button></div>
          {configImported&&<p className="source-import-note" role="status">仅生成配置已导入，当前文档仍是“{sourceLabel.name}”。{/^https?:/.test(settings.input)?<button type="button" onClick={()=>setSourceOpen(true)}>获取配置中的文档</button>:<button type="button" onClick={()=>fileInput.current?.click()}>导入对应文档文件</button>}</p>}
          {undo&&<div className="undo-bar" role="status">已清空。可在 12 秒内恢复当前标签页中的内容。<button type="button" onClick={restoreClear}>撤销清空</button></div>}
          {inputOpen && (
            <div className="source-grid">
              <section className="source-panel">
                <div className="section-head">
                  <h3>
                    <span className="file-symbol">{`{ }`}</span> OpenAPI JSON
                  </h3>
                  <div>
                    <button type="button" className="source-settings-button" aria-haspopup="dialog"
                      onClick={() => setSourceOpen(true)}><span aria-hidden="true">↗</span> 从链接导入</button>
                    <button type="button" className="import-file" onClick={()=>fileInput.current?.click()}>导入文件</button>
                    <button
                      type="button"
                      className="text-button"
                      onClick={clear}
                    >
                      清空
                    </button>
                  </div>
                </div>
                <label htmlFor="spec" className="sr-only">
                  Swagger或OpenAPI JSON
                </label>
                <textarea
                  ref={editor}
                  id="spec"
                  value={input}
                  onChange={(e) => {
                    setUndo(null);
                    setSourceLabel({kind:"edited",name:"粘贴 / 手动编辑"});
                    setConfigImported(false);
                    edits.current++;
                    if (busy) cancelGeneration();
                    setInput(e.target.value);
                    setError("");
                    setNotice("");
                  }}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                      e.preventDefault();
                      generate();
                    }
                  }}
                  spellCheck={false}
                  autoComplete="off"
                  autoCapitalize="off"
                  placeholder='{"openapi":"3.0.0","paths":{…}}'
                  aria-invalid={Boolean(error)}
                  aria-describedby="input-error"
                />
                <div className="editor-footer">
                  <span>
                    UTF-8 ·{" "}
                    {(new TextEncoder().encode(input).length / 1024).toFixed(1)}{" "}
                    KiB / 8 MiB
                  </span>
                  <span>⌘ / Ctrl + Enter</span>
                </div>
              </section>
              <section
                className="settings-panel"
                aria-labelledby="settings-title"
              >
                <div className="settings-heading">
                  <h3 id="settings-title">生成配置 <span>CONFIGURATION</span></h3>
                  <button type="button" className="view-config" aria-haspopup="dialog"
                    onClick={() => configDialog.current?.showModal()}>查看配置</button>
                </div>
                <p className="config-help settings-intro">选择技术栈即可生成，其他设置使用默认值。</p>
                <details className="settings-section common-settings" open>
                  <summary><span>生成目标</span><small>默认设置即可开始</small></summary>
                <div className="settings-grid">
                  <label htmlFor="config-target" className="target-field">SDK 技术栈
                    <select id="config-target" value={target} onChange={e => changeTarget(e.target.value as SDKTarget)}>
                      {SDK_TARGETS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                    <small>{SDK_TARGETS.find(item => item.value === target)?.description}</small>
                  </label>
                </div>
                <p className="config-help">默认命名空间 main，按路径分组，自动识别前缀和业务地址。</p>
                </details>
                <details className="settings-section advanced-settings"><summary><span>高级设置</span><small>命名规则、服务地址与 Hooks</small></summary><div className="settings-grid">
                  <label htmlFor="config-namespace">命名空间
                    <input {...fieldAttrs("config-namespace")} value={settings.namespace ?? "main"} spellCheck={false}
                      onChange={(e) => updateConfig({ namespace: e.target.value })} placeholder="main" />
                    {fieldMessage("config-namespace")}<small>API.{settings.namespace || "main"}.controller.method</small>
                  </label>
                  <label htmlFor="config-group">控制器分组
                    <select id="config-group" value={settings.groupBy ?? "path"}
                      onChange={(e) => updateConfig({ groupBy: e.target.value as "path" | "tag" })}>
                      <option value="path">按路径分组</option><option value="tag">按首个 Tag 分组</option>
                    </select>
                    <small>中文 Tag 可在下方映射为英文</small>
                  </label>
                  <label htmlFor="config-prefix">移除公共路径前缀
                    <input {...fieldAttrs("config-prefix")} value={settings.stripPrefix ?? ""} spellCheck={false}
                      onChange={(e) => updateConfig({ stripPrefix: e.target.value || undefined })}
                      placeholder="自动识别，如 /v1/api" />
                    {fieldMessage("config-prefix")}<small>只影响分组，不改变请求 URL</small>
                  </label>
                  <label htmlFor="config-base">覆盖服务地址
                    <input {...fieldAttrs("config-base")} value={settings.baseUrl ?? ""} spellCheck={false}
                      onChange={(e) => updateConfig({ baseUrl: e.target.value || undefined })}
                      placeholder="使用文档中的 servers" />
                    {fieldMessage("config-base")}<small>留空则使用文档默认地址</small>
                  </label>
                </div>
                {["all", "next", "vite-ssr"].includes(target) ? <label className="check">
                  <input type="checkbox" checked={settings.hooks !== false}
                    onChange={(e) => updateConfig({ hooks: e.target.checked })} />
                  <span><strong>生成 SWR Hooks</strong><small>默认自动请求 · 支持手动触发</small></span>
                  <span className="swr-mark">SWR ↗</span>
                </label> : <p className="target-hint">{target === "react" ? "包含 request 与 SWR Hooks；默认自动请求，可配置手动触发。" : "此技术栈仅包含 request，不引入 React 或 SWR。"}</p>}
                </details>
                <details className="settings-section mapping-settings">
                  <summary><span>分组命名</span><small>{mappings.length} 条映射 · {settings.translateNames !== false ? "自动翻译" : "离线命名"}</small></summary>
                  <label className="translate-toggle">
                    <input type="checkbox" checked={settings.translateNames !== false}
                      onChange={(e) => updateConfig({ translateNames: e.target.checked })} />
                    生成时自动翻译缺失的中文分组
                  </label>
                  <details className="translation-options">
                    <summary>翻译服务设置 <small>{({ mymemory: "MyMemory · 免密钥", youdao: "有道智云", baidu: "百度翻译", google: "Google Cloud Translation" })[translation.provider]}</small></summary>
                  <div className="translation-settings">
                    <label htmlFor="translation-provider">翻译服务
                      <select id="translation-provider" value={translation.provider}
                        onChange={(e) => {
                          const provider = e.target.value as typeof translation.provider;
                          updateConfig({ translation: { ...TRANSLATION_DEFAULTS[provider],
                            ...(provider !== "mymemory" ? { proxyUrl: translation.proxyUrl ?? "http://127.0.0.1:4190/translate" } : {}) } });
                        }}>
                        <option value="mymemory">MyMemory · 免密钥</option>
                        <option value="youdao">有道智云</option>
                        <option value="baidu">百度翻译</option>
                        <option value="google">Google Cloud Translation</option>
                      </select>
                    </label>
                    {translation.provider !== "mymemory" && <>
                      <div className="settings-grid">
                        {translation.provider !== "google" && <label htmlFor="translation-app-id">
                          {translation.provider === "youdao" ? "AppKey 环境变量" : "AppID 环境变量"}
                          <input id="translation-app-id" value={translation.appIdEnv ?? ""} spellCheck={false}
                            onChange={(e) => updateTranslation({ appIdEnv: e.target.value })} />
                        </label>}
                        <label htmlFor="translation-api-key">{translation.provider === "google" ? "API Key 环境变量" : "应用密钥环境变量"}
                          <input id="translation-api-key" value={translation.apiKeyEnv ?? ""} spellCheck={false}
                            onChange={(e) => updateTranslation({ apiKeyEnv: e.target.value })} />
                        </label>
                      </div>
                      <label htmlFor="translation-proxy">网页翻译代理地址
                        <input id="translation-proxy" value={translation.proxyUrl ?? ""} spellCheck={false}
                          placeholder="http://127.0.0.1:4190/translate"
                          onChange={(e) => updateTranslation({ proxyUrl: e.target.value || undefined })} />
                      </label>
                      <p className="config-help">将真实密钥填入代码库的 .env；这里填写环境变量名。CLI 可直接翻译；网页使用你自己的代理，密钥留在本机。</p>
                      <code className="translation-command">npx chainspec translate-server --config chainspec.config.json --origin {location.origin}</code>
                      <p className="config-help">先导出配置，在其旁边创建 .env 并启动上述命令。浏览器可能需要允许本地网络访问，也可使用自己的 HTTPS 代理。</p>
                    </>}
                  </div>
                  </details>
                  <p className="config-help">仅向所选服务发送缺失的分组名称，不发送接口、模型或请求体。成功映射保存在当前浏览器及下载配置中；已有映射优先复用。</p>
                  <div className="mapping-list">
                    {mappings.map(([tag, name], i) => (
                      <div className="mapping-row" key={i}>
                        <label><input {...fieldAttrs(`mapping-tag-${i}`)} aria-label={`原分组 ${i + 1}`} placeholder="短信管理" value={tag}
                          onChange={(e) => updateMapping(i, e.target.value, name)} />{fieldMessage(`mapping-tag-${i}`)}</label>
                        <span aria-hidden="true">→</span>
                        <label><input {...fieldAttrs(`mapping-name-${i}`)} aria-label={`英文名称 ${i + 1}`} placeholder="sms" value={name} spellCheck={false}
                          onChange={(e) => updateMapping(i, tag, e.target.value)} />{fieldMessage(`mapping-name-${i}`)}</label>
                        <button type="button" aria-label={`删除映射 ${i + 1}`}
                          onClick={() => updateConfig({ controllerNames: Object.fromEntries(mappings.filter((_, index) => index !== i)) })}>×</button>
                      </div>
                    ))}
                  </div>
                  <div className="mapping-actions">
                    <button type="button" className="add-mapping" disabled={mappings.some(([tag]) => !tag)}
                      onClick={() => updateConfig({ controllerNames: { ...settings.controllerNames, "": "" } })}>＋ 添加映射</button>
                    <button type="button" disabled={Boolean(parsedConfig.error)} onClick={() => void copyMappings()}>复制映射</button>
                    <button type="button" onClick={() => {
                      try { localStorage.removeItem(namesCacheKey); setNotice("浏览器名称缓存已清除，当前配置保留，可继续导出。"); }
                      catch { setNotice("浏览器未允许清除本地缓存。"); }
                    }}>清除浏览器缓存</button>
                  </div>
                  <details className="paste-mappings"><summary>粘贴已有映射</summary>
                    <textarea aria-label="粘贴分组英文映射" value={mappingText} onChange={(e) => setMappingText(e.target.value)}
                      placeholder={'{ "短信管理": "sms" }\n或每行：短信管理=sms'} spellCheck={false} />
                    <button type="button" disabled={!mappingText.trim()} onClick={applyMappingText}>应用映射</button>
                  </details>
                </details>
                <details className="settings-section cli-settings">
                  <summary><span>CLI 与导出</span><small>文件路径、配置导入导出</small></summary>
                  <div className="settings-grid">
                    <label htmlFor="config-source">文档来源
                      <input {...fieldAttrs("config-source")} value={settings.input} spellCheck={false}
                        onChange={(e) => updateConfig({ input: e.target.value })} placeholder="./openapi.json 或 JSON 链接" />
                      {fieldMessage("config-source")}<small>仅供 CLI 使用；网页读取请使用“从链接导入”</small>
                    </label>
                    <label htmlFor="config-output">SDK 输出目录
                      <input {...fieldAttrs("config-output")} value={settings.output} spellCheck={false}
                        onChange={(e) => updateConfig({ output: e.target.value })} placeholder="./src/api" />
                      {fieldMessage("config-output")}<small>CLI 路径相对于配置文件</small>
                    </label>
                  </div>
                <div className="config-actions">
                  <label className="import-file">导入配置<input type="file" accept=".json,application/json"
                    onChange={(e) => { void importConfig(e.target.files?.[0]); e.target.value = ""; }} /></label>
                  <button type="button" onClick={exportConfig} disabled={Boolean(parsedConfig.error)}>↓ 导出配置</button>
                </div>
                <details className="config-help"><summary>查看 CLI 使用方式</summary>
                  <code>npx --package=@batype/chainspec chainspec --config chainspec.config.json</code>
                  <p>重复生成加 --update；仅替换未经手工修改的 CLI 生成目录。</p>
                </details>
                </details>
                <p id="config-error" className="config-error" role="alert">{parsedConfig.error}{parsedConfig.error&&<button type="button" onClick={focusConfigError}>定位配置问题</button>}</p>
              </section>
            </div>
          )}
          <p className="error" role="alert" id="input-error">
            {error}
          </p>
          <div className="status" role="status" aria-live="polite">
            {notice ||
              (dirty && result
                ? "输入或配置已更改，请重新生成；下载与复制暂不可用。"
                : busy
                  ? "正在本地Worker中解析文档…"
                  : "")}
          </div>
          {ready && <div className="generated-link"><span>✓ {result?.title} 已生成，可进入独立工作台体验与下载。</span><a href="#/workspace">进入 SDK 工作台 →</a></div>}
          {!result && !busy && (
            <div className="empty">
              <span>{`{ ↳ }`}</span>
              <h3>
                {error
                  ? "修正文档或配置后，重新生成"
                  : "你的 SDK，从一份 JSON 开始。"}
              </h3>
              <p>粘贴 OpenAPI JSON，或载入合成示例体验。</p>
            </div>
          )}
        </section>
        <section id="guide" className="guide">
          <div className="guide-heading">
            <span className="eyebrow">BUILT FOR YOUR WORKFLOW</span>
            <h2>类型、请求、缓存，各就各位。</h2>
            <p>下载的是能放进工程里的 TypeScript 源码。</p>
            <a className="docs-text-link" href="#/guide">阅读完整接入指南 →</a>
          </div>
          <div className="guide-grid">
            <article>
              <span className="guide-number">01 / TYPE</span>
              <h3>接口变了，编辑器先知道。</h3>
              <p>
                模型与请求参数分开生成。缺失的响应模型明确标为 unknown，readOnly
                与 writeOnly 按方向处理。
              </p>
              <code>Promise&lt;OutputSchemas['User']&gt;</code>
            </article>
            <article>
              <span className="guide-number">02 / EXTEND</span>
              <h3>继续用你熟悉的请求层。</h3>
              <p>
                替换请求适配器，串联异步前置、后置与错误处理。认证、日志和响应处理由你的业务决定。
              </p>
              <code>beforeRequest → request → afterResponse</code>
            </article>
            <article>
              <span className="guide-number">03 / REACT</span>
              <h3>自动或手动，由你选择。</h3>
              <p>
                useRequest 默认自动请求；enabled: false 后用 trigger，refresh 可重复获取。
                useMutation 保持手动。切换身份时更新 cacheScope。
              </p>
              <code>
                const {"{ data, trigger, refresh }"} = API.…useRequest(…)
              </code>
            </article>
          </div>
        </section>
        <details className="limits">
          <summary>
            支持范围与需要留意的边界 <span>＋</span>
          </summary>
          <div>
            <p>
              支持Swagger 2.0、OpenAPI 3.0 / 3.1 JSON，本地
              $ref、常见Schema类型、组合类型、枚举、参数与JSON/平面表单。只导入JSON，不读取Swagger
              UI网页HTML，不自动抓取外部引用。
            </p>
            <p>
              类型不等于运行时验证；不保证覆盖全部JSON
              Schema约束。多媒体类型会选择并提示，缺少模型使用unknown。鉴权方案不会自动转为真实凭据。生成器不发送业务请求；下载后的SDK只有被业务调用时才发送请求。
            </p>
            <p>
              仅保存主题与英文分组名称缓存；文档和结果保留在本页内存。清空可移除当前文档与生成结果。SWR入口必须遵循React
              Hooks规则。更多边界与自定义适配器示例见下载包README。
            </p>
          </div>
        </details>
        <footer className="footer">
          <a href="#top" className="footer-brand">
            ChainSpec <span>契约清楚，调用顺手。</span>
          </a>
          <div>
            <span>React + Vite · MIT</span>
            <a
              href="https://github.com/batype/chainspec"
              target="_blank"
              rel="noreferrer"
            >
              开源代码 ↗
            </a>
          </div>
        </footer>
      </main>}
    </>
  );
}
