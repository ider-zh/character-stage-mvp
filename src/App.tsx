import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { Stage } from './Stage';
import { Icon } from './icons';
import { useSharedStage } from './useSharedStage';
import { useCamera } from './useCamera';
import type { Job } from './types';

const palettes = ['mint', 'lilac', 'peach', 'sky'];
const descriptions: Record<string, string> = { 苔团: '把松软的好心情，分你一点。', 月芽: '来自月亮的，慢半拍的朋友。', 橘子: '今天的阳光，刚好够晒尾巴。' };
export default function App() {
  const shared = useSharedStage();
  const camera = useCamera();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [name, setName] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [checking, setChecking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const about = useRef<HTMLDialogElement>(null);
  const xhr = useRef<XMLHttpRequest | null>(null);
  const fileVersion = useRef(0);
  const selected = shared.state.characters.find(c => c.id === selectedId) ?? shared.state.characters[0];
  const job = shared.state.jobs.find(j => j.id === jobId);
  const processing = job?.status === 'queued' || job?.status === 'processing';
  const busy = checking || uploading || processing;
  const connected = shared.connection === 'connected';
  const motionPaused = paused || reduced;
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => () => { xhr.current?.abort(); fileVersion.current += 1; }, []);
  useEffect(() => {
    if (job?.status === 'ready' && job.characterId) {
      setSelectedId(job.characterId);
      setFile(null);
      setName('');
      if (input.current) input.current.value = '';
    }
  }, [job?.status, job?.characterId]);
  async function chooseFile(candidate?: File) {
    if (!candidate || busy) return;
    const version = ++fileVersion.current;
    setUploadError('');
    setJobId(null);
    setFile(null);
    setName('');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(candidate.type)) { setUploadError('请选择 PNG、JPG 或 WebP 图片。'); return; }
    if (candidate.size > 5 * 1024 * 1024) { setUploadError('图片有点大，请换一张不超过 5 MB 的图片。'); return; }
    setChecking(true);
    try {
      const image = await createImageBitmap(candidate);
      const width = image.width, height = image.height;
      image.close();
      if (version !== fileVersion.current) return;
      if (width < 64 || height < 64 || width > 4096 || height > 4096 || width * height > 16000000) throw new Error('图片宽高须在 64–4096 像素之间，且不超过 1600 万像素。');
      setFile(candidate);
      setName(candidate.name.replace(/\.[^.]+$/, '').slice(0, 30));
    } catch (error) {
      if (version === fileVersion.current) setUploadError(error instanceof Error && error.message.startsWith('图片') ? error.message : '这张图片暂时读不出来，请换一张试试。');
    } finally {
      if (version === fileVersion.current) setChecking(false);
    }
  }
  function submitUpload() {
    if (!file || !name.trim() || busy || !connected) return;
    setUploadError('');
    setJobId(null);
    setProgress(0);
    setUploading(true);
    const request = new XMLHttpRequest();
    xhr.current = request;
    request.open('POST', '/api/characters');
    request.setRequestHeader('Content-Type', file.type);
    request.setRequestHeader('X-Character-Name', encodeURIComponent(name.trim()));
    request.timeout = 60000;
    request.upload.onprogress = event => { if (event.lengthComputable) setProgress(Math.round(event.loaded / event.total * 100)); };
    const failed = (message: string) => { setUploading(false); setUploadError(message); xhr.current = null; };
    request.onerror = () => failed('上传没有完成，请检查连接后再试一次。');
    request.ontimeout = () => failed('上传等待超时了，图片还在这里，可以重新试试。');
    request.onabort = () => { setUploading(false); xhr.current = null; };
    request.onload = () => {
      setUploading(false);
      xhr.current = null;
      try {
        const response = JSON.parse(request.responseText) as { job?: Job; error?: string | { code?: string; message?: string }; message?: string };
        if (request.status !== 202 || !response.job) { setUploadError(typeof response.error === 'string' ? response.error : response.error?.message || response.message || '上传没有成功，请稍后再试。'); return; }
        shared.addJob(response.job);
        setJobId(response.job.id);
      } catch { setUploadError('服务器返回了不完整的结果，请稍后再试。'); }
    };
    request.send(file);
  }
  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragOver(false);
    void chooseFile(event.dataTransfer.files[0]);
  }
  const bounce = (id: string) => shared.send({ type: 'bounce', characterId: id });
  const cameraActive = camera.status === 'on' || camera.status === 'loading';
  const activeJobCount = shared.state.jobs.filter(j => j.status === 'queued' || j.status === 'processing').length;
  return <>
    <header className="site-header">
      <a className="brand" href="#" aria-label="同频小院首页"><span className="brand-mark"><Icon name="spark" size={25} /></span><span className="brand-name">同频小院<small>little together</small></span></a>
      <nav aria-label="主导航"><a href="#courtyard" className="active">共享舞台</a><a href="#library">角色图鉴</a><button onClick={() => about.current?.showModal()}>关于小院 <Icon name="arrow" size={13} /></button></nav>
      <div className="header-presence"><span className={`connection-dot ${connected ? '' : 'offline'}`} /><span>{connected ? `${shared.state.online} 人在小院` : '正在连接小院'}</span><span className="live-pill">LIVE</span></div>
    </header>
    <main>
      <section className="hero">
        <div className="hero-copy"><div className="eyebrow"><span /> A LITTLE SPACE, SHARED WITH EVERYONE</div><h1>让你的角色，<br /><span>在这里相遇。</span><span className="hero-star"><Icon name="spark" size={47} /></span></h1><p>带上一个喜欢的角色，走进同一个小院。<br />一起动一动、发发呆，把一点可爱分享给彼此。</p></div>
        <div className="hero-note"><div className="note-line" /><span className="note-number">01 /</span><p>不同的你我，<br />同频的小小日常。</p><div className="note-bottom"><span className="mini-spark">✳</span><span>COME AS YOU ARE</span></div></div>
      </section>
      <section className="workspace" id="courtyard" aria-labelledby="stage-heading">
        <div className="stage-section">
          <div className="section-heading"><div className="heading-title"><span className="tiny-square" /><h2 id="stage-heading">小院正在发生</h2><span className="section-sub">THE SHARED STAGE</span></div><span className="shared-tag"><span className="connection-dot" /> 所有人看见同一个舞台</span></div>
          <div className="stage-frame">
            <Stage characters={shared.state.characters} leases={shared.state.leases} clientId={shared.clientId} connected={connected} selectedId={selected?.id ?? null} onSelect={setSelectedId} onAcquire={id => shared.send({ type: 'acquire', characterId: id })} onMove={shared.move} onRelease={shared.release} onBounce={bounce} bounces={shared.bounces} feedback={camera.feedback} paused={motionPaused} />
            <div className="stage-toolbar">
              <div className="stage-selection">{selected ? <><span className="selection-avatar"><img src={selected.assetUrl} alt="" /></span><span><strong>{selected.name}</strong><small>{shared.state.leases.some(l => l.characterId === selected.id && l.owner !== shared.clientId) ? '朋友正在移动它' : '已选中 · 试着打个招呼'}</small></span></> : <span className="muted">等待朋友加入</span>}</div>
              <div className="stage-actions"><button className="bounce-button" data-testid="bounce-button" disabled={!selected || !connected} onClick={() => selected && bounce(selected.id)}><Icon name="spark" size={16} /><span>跳一下</span></button><button className="icon-button motion-button" aria-label={reduced ? '系统已开启减少动态' : paused ? '继续自然动画' : '暂停自然动画'} title={reduced ? '遵循系统减少动态设置' : paused ? '继续自然动画' : '暂停自然动画'} disabled={reduced} onClick={() => setPaused(!paused)}><Icon name={motionPaused ? 'play' : 'pause'} size={17} /></button><span className="toolbar-divider" /><button className={`camera-button ${cameraActive ? 'is-on' : ''}`} data-testid="camera-toggle" aria-pressed={cameraActive} onClick={() => cameraActive ? camera.stop() : void camera.start()}><Icon name="camera" size={17} /><span>{camera.status === 'loading' ? '取消开启' : camera.status === 'on' ? '关闭镜头' : '镜头互动'}</span></button></div>
            </div>
          </div>
          <div className="stage-caption"><div className="input-mode"><Icon name={camera.status === 'on' ? 'camera' : 'cursor'} size={14} /><span>{camera.status === 'on' ? camera.feedback?.present ? '本地镜头互动 · 试着转头或眨眼' : '镜头已开启 · 等待发现你' : '鼠标互动已就绪'}<span className="caption-separator">/</span>{motionPaused ? '自然动画已暂停' : '自然呼吸与轻轻摇摆'}</span></div><button className={`connection-label ${connected ? '' : 'is-offline'}`} data-testid="connection-status" onClick={() => !connected && shared.retry()} disabled={connected}>{connected ? <><span className="connection-dot" /> 已实时同步</> : <><Icon name="retry" size={13} /> 连接中，点击重试</>}</button></div>
          <p className="camera-privacy"><Icon name="info" size={13} /> 摄像头默认关闭。开启后画面仅在你的浏览器处理，不上传、不录制。</p>
          <p data-testid="camera-status" data-camera-state={camera.status} className={`camera-status ${camera.status === 'error' ? 'warning' : ''}`} role="status">{camera.message}</p>
          {shared.notice && <p className="inline-notice warning" role="status">{shared.notice}</p>}
          {!connected && <p className="inline-notice" role="status">正在恢复连接。连接恢复前暂时不能移动角色或上传，恢复后会自动同步小院。</p>}
        </div>
        <aside className="upload-panel" aria-labelledby="upload-heading"><div className="upload-heading"><span className="upload-symbol"><Icon name="plus" size={23} /></span><span className="eyebrow">MAKE ROOM FOR ONE MORE</span></div><h2 id="upload-heading">带一位新朋友来</h2><p className="upload-description">一张图片，就是一个新开始。<br />你的角色会出现在大家的小院里。</p>
          <div className={`dropzone ${dragOver ? 'is-over' : ''} ${file ? 'has-file' : ''} ${busy ? 'is-busy' : ''}`} onDragOver={event => { event.preventDefault(); if (!busy) setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop}>
            <input data-testid="upload-input" ref={input} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event: ChangeEvent<HTMLInputElement>) => void chooseFile(event.target.files?.[0])} aria-label="选择角色图片" disabled={busy} />
            {file && preview ? <><img className="upload-preview" src={preview} alt="待上传的角色预览" /><span className="file-info">{file.name}<small>{(file.size / 1024 / 1024).toFixed(2)} MB</small></span>{!busy && <button className="remove-file" aria-label="移除所选图片" onClick={() => { setFile(null); setName(''); setUploadError(''); if (input.current) input.current.value = ''; }}><Icon name="close" size={15} /></button>}</> : <button className="dropzone-pick" type="button" onClick={() => input.current?.click()} disabled={busy}><span className="upload-icon"><Icon name="upload" size={24} /></span><strong>{checking ? '正在检查图片…' : '拖入图片，或点击选择'}</strong><small>PNG / JPG / WebP · 最大 5 MB</small><span className="transparent-tip">透明背景的角色，效果更好</span></button>}
          </div>
          {file && <label className="name-field">给朋友取个名字<input data-testid="upload-name" value={name} onChange={event => setName(event.target.value)} maxLength={30} disabled={busy} placeholder="比如：小小的好心情" /></label>}
          <button className="primary-button" data-testid="upload-submit" disabled={busy || !connected || (!!file && !name.trim())} onClick={() => file ? submitUpload() : input.current?.click()}>{uploading ? `正在上传 ${progress}%` : processing ? '正在为朋友整理行装…' : checking ? '正在检查图片…' : file ? '让它加入小院' : '选择角色图片'}{busy ? <span className="spinner" /> : <Icon name="arrow" size={18} />}</button>
          <div data-testid="upload-status" className="upload-status" aria-live="polite">{uploading && <><div className="progress-track"><span style={{ width: `${progress}%` }} /></div><p>{progress < 100 ? '正在上传图片，请稍等。' : '图片已发送，等待服务器接收。'}</p></>}{processing && <p><span className="mini-spinner" /> {job?.status === 'queued' ? '图片已接收，正在排队处理。' : '正在生成安全的角色图片与基础动画配置。'}</p>}{job?.status === 'ready' && <p className="upload-success"><Icon name="check" size={15} /> 新朋友已加入，大家都能看见它了。</p>}{(uploadError || job?.status === 'failed') && <p className="upload-error">{uploadError || job?.error || '处理没有成功，请换张图片再试。'}</p>}</div>
          <div className="upload-footnote"><Icon name="info" size={15} /><span>这是一个公开的小院。请只上传有权使用的角色图片，避免照片或私人信息。</span></div>
          <div className="basic-note"><span>BASIC MOTION</span><p>先从简单的可爱开始</p><small>提供呼吸、摇摆与跳跃效果。<br />暂不包含 AI 拆层或 Live2D 骨骼绑定。</small></div>
        </aside>
      </section>
      <section className="library-section" id="library" aria-labelledby="library-heading"><div className="section-heading library-heading"><div className="heading-title"><span className="tiny-square" /><h2 id="library-heading">住在小院的朋友</h2><span className="count-pill">{shared.state.characters.length}</span></div><p>每个角色，都有一点自己的可爱。<span>{activeJobCount ? ` ${activeJobCount} 位朋友正在准备加入` : ' 点击卡片，在舞台上找到它'}</span></p></div>
        <div className="character-grid">{shared.state.characters.map((character, index) => <button key={character.id} data-testid={`character-card-${character.id}`} className={`character-card ${palettes[index % palettes.length]} ${selected?.id === character.id ? 'is-selected' : ''}`} aria-pressed={selected?.id === character.id} onClick={() => { setSelectedId(character.id); document.getElementById('courtyard')?.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'start' }); }}><div className="card-visual"><span className="card-index">{String(index + 1).padStart(2, '0')}</span><span className="card-mode"><i /> 基础动态</span><div className="card-halo" /><img src={character.assetUrl} alt={character.name} loading="lazy" /><span className="card-spark"><Icon name="spark" size={17} /></span><span className="card-onstage">{selected?.id === character.id ? <><Icon name="check" size={12} /> 已选中</> : <><Icon name="arrow" size={13} /> 在舞台上找到它</>}</span></div><div className="card-details"><div><h3>{character.name}</h3><p>{descriptions[character.name] ?? '一位刚刚来到小院的新朋友。'}</p></div><span className="card-source">{character.source === 'seed' ? '小院原住民' : '朋友带来的'}</span></div></button>)}</div>
        {!shared.state.characters.length && <div className="library-empty">{connected ? '这里还空着，第一位朋友可以是你的角色。' : '正在和小院的朋友们打招呼…'}</div>}
      </section>
      <section className="closing-note"><span className="closing-flower"><Icon name="spark" size={24} /></span><p>不必做什么大事。<span>让可爱的事情，在一起发生。</span></p><span className="closing-line" /><span className="closing-en">A SMALL PLACE.<br />A LITTLE MORE JOY.</span></section>
    </main>
    <footer><a className="footer-brand" href="#">同频小院 <span>little together</span></a><p>一个共享、轻盈、慢一点的角落。</p><button onClick={() => about.current?.showModal()}>使用与隐私 <Icon name="arrow" size={13} /></button></footer>
    <dialog ref={about} className="about-dialog"><div className="dialog-top"><span className="eyebrow">ABOUT THIS LITTLE PLACE</span><button className="icon-button" aria-label="关闭说明" onClick={() => about.current?.close()}><Icon name="close" /></button></div><h2>欢迎来到同频小院。</h2><p>这里是一个共享的角色舞台。所有访问者看见同一份公开角色库，移动和跳跃会实时同步。</p><ul><li>角色会保存在服务器中，刷新后仍然在。有人拖动时，其他人需要等它放手。</li><li>上传图片会经过格式检查并统一转换为 PNG。请勿上传私人信息或无权使用的作品。</li><li>当前提供单张图片的基础变形动画，并非自动生成的分层 Live2D 模型。</li><li>镜头互动需要你主动开启；头部位置和眨眼带来轻微的整图反馈。视频与面部反馈只留在本地浏览器，不发送给其他访问者。关闭镜头会停止摄像头。</li><li>也可以只用鼠标互动。键盘选中角色后，用方向键移动、空格跳跃。系统减少动态设置会被尊重。</li></ul><button className="primary-button" onClick={() => about.current?.close()}>回到小院<Icon name="arrow" size={18} /></button></dialog>
  </>;
}
