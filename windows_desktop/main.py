import sys
from pathlib import Path
from PySide6.QtCore import Qt, QThread, Signal
from PySide6.QtWidgets import (
    QApplication,
    QCheckBox,
    QComboBox,
    QFileDialog,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QMainWindow,
    QMessageBox,
    QProgressBar,
    QPushButton,
    QSlider,
    QStackedWidget,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from app.config import APP_NAME, DEFAULT_EXPORT_DIR, EMOTIONS, GEMINI_MODELS, KHMER_VOICES, PROJECTS_DIR
from app.database import LocalDatabase
from app.key_manager import ApiKeyRotationManager
from app.services.asr_groq import transcribe_chunks_with_groq
from app.services.audio_sync import fit_and_mix_audio
from app.services.diarizer import diarize_and_assign_speakers
from app.services.exporter import export_mp4_video, write_khmer_srt
from app.services.translator_gemini import translate_segments_to_khmer
from app.services.tts_khmer import synthesize_khmer_line
from app.services.video_analyzer import extract_and_chunk_audio, extract_embedded_subtitles, probe_video
from app.services.voice_cloner import register_authorized_voice_sample


class DubbingWorker(QThread):
    progress = Signal(int, str)
    finished_ok = Signal(str)
    failed = Signal(str)

    def __init__(self, db: LocalDatabase, rotation: ApiKeyRotationManager, project_id: str):
        super().__init__()
        self.db = db
        self.rotation = rotation
        self.project_id = project_id

    def run(self) -> None:
        try:
            proj = self.db.get_project(self.project_id)
            if not proj:
                raise RuntimeError("Project not found")
            video_path = Path(proj["video_path"])
            work_dir = PROJECTS_DIR / self.project_id
            work_dir.mkdir(parents=True, exist_ok=True)

            self.progress.emit(10, "Analyzing video & checking embedded subtitles...")
            meta = probe_video(video_path)
            embedded = extract_embedded_subtitles(video_path, work_dir / "embedded.srt") if meta.has_subtitles else []

            if embedded:
                segments = [
                    {
                        "idx": i,
                        "start_time": s,
                        "end_time": e,
                        "speaker_id": "SPEAKER_01",
                        "source_text": txt,
                    }
                    for i, (s, e, txt) in enumerate(embedded)
                ]
                detected_lang = proj["source_language"]
            else:
                self.progress.emit(18, "Extracting & chunking audio for Groq Whisper...")
                chunks = extract_and_chunk_audio(video_path, work_dir / "chunks", chunk_sec=90)
                self.progress.emit(28, "Running Groq Whisper speech recognition...")
                segments, detected_lang = transcribe_chunks_with_groq(self.rotation, chunks, proj["source_language"])

            self.progress.emit(45, "Detecting speakers & character voices...")
            diar = diarize_and_assign_speakers(self.rotation, segments, proj["gemini_model"])
            assign_map = {int(a["idx"]): a["speaker_id"] for a in diar.get("assignments", [])}
            voice_map = {s["speaker_id"]: s.get("recommended_voice", "km-KH-SreymomNeural") for s in diar.get("speakers", [])}
            for seg in segments:
                sp = assign_map.get(seg["idx"], "SPEAKER_01")
                seg["speaker_id"] = sp
                seg["voice_name"] = voice_map.get(sp, "km-KH-SreymomNeural")

            self.progress.emit(60, "Translating dialogue into expressive Khmer via Gemini AI...")
            segments = translate_segments_to_khmer(
                self.rotation,
                segments,
                diar.get("story_summary", ""),
                proj["gemini_model"],
            )

            tts_dir = work_dir / "tts"
            for i, seg in enumerate(segments):
                pct = 65 + int(((i + 1) / max(1, len(segments))) * 22)
                self.progress.emit(pct, f"Generating Khmer voice {i + 1}/{len(segments)} ({seg['emotion']})...")
                out_mp3 = tts_dir / f"seg_{i:04d}.mp3"
                synthesize_khmer_line(
                    seg["khmer_text"] or seg["source_text"],
                    seg["voice_name"],
                    seg["emotion"],
                    out_mp3,
                )
                seg["tts_path"] = str(out_mp3)

            self.db.replace_segments(self.project_id, segments)
            self.progress.emit(90, "Synchronizing Khmer audio & preserving background music...")
            mixed_wav = fit_and_mix_audio(
                video_path,
                segments,
                work_dir,
                bgm_volume=float(proj["bgm_volume"]),
                dub_volume=float(proj["dub_volume"]),
                voice_reduction=str(proj["voice_reduction"]),
            )
            self.db.update_project(
                self.project_id,
                source_language=detected_lang,
                story_summary=diar.get("story_summary", ""),
                status="mixed",
                progress_pct=100,
                current_step="Ready for MP4 Export",
            )
            self.progress.emit(100, "Auto Dubbing Complete!")
            self.finished_ok.emit(str(mixed_wav))
        except Exception as exc:
            self.failed.emit(str(exc))


class MainWindow(QMainWindow):
    NAV_ITEMS = [
        "1. Home Dashboard",
        "2. Import Video",
        "3. Automatic Speech Recognition",
        "4. AI Translation",
        "5. Speaker Detection",
        "6. Voice Management",
        "7. Voice Cloning",
        "8. Emotion Settings",
        "9. Gemini API Manager",
        "10. Groq API Manager",
        "11. Audio Synchronization",
        "12. Video Preview",
        "13. Export MP4",
        "14. Project History",
        "15. Application Settings",
    ]

    def __init__(self):
        super().__init__()
        self.db = LocalDatabase()
        self.rotation = ApiKeyRotationManager(self.db)
        self.current_project_id: str | None = None
        self.worker: DubbingWorker | None = None

        self.setWindowTitle(f"{APP_NAME} — Windows 10/11")
        self.resize(1360, 860)
        self._apply_win11_dark_theme()
        self._build_ui()

    def _apply_win11_dark_theme(self) -> None:
        self.setStyleSheet(
            """
            QMainWindow, QWidget { background-color: #0B0F17; color: #F1F5F9; font-family: 'Segoe UI', 'Khmer OS Siemreap', sans-serif; font-size: 13px; }
            QListWidget { background-color: #111827; border-right: 1px solid #1F2937; padding: 8px; }
            QListWidget::item { padding: 10px 12px; border-radius: 6px; margin-bottom: 2px; }
            QListWidget::item:selected { background-color: #1E293B; color: #F59E0B; font-weight: 600; }
            QPushButton { background-color: #1E293B; border: 1px solid #334155; padding: 8px 16px; border-radius: 6px; font-weight: 600; }
            QPushButton:hover { background-color: #334155; }
            QPushButton#PrimaryBtn { background-color: #F59E0B; color: #0B0F17; border: none; }
            QPushButton#PrimaryBtn:hover { background-color: #D97706; }
            QLineEdit, QComboBox { background-color: #111827; border: 1px solid #334155; padding: 7px 10px; border-radius: 6px; }
            QTableWidget { background-color: #111827; border: 1px solid #1F2937; gridline-color: #1F2937; }
            QHeaderView::section { background-color: #1E293B; padding: 6px; border: none; font-weight: 600; }
            QProgressBar { background-color: #1E293B; border-radius: 5px; text-align: center; height: 20px; }
            QProgressBar::chunk { background-color: #F59E0B; border-radius: 5px; }
            """
        )

    def _build_ui(self) -> None:
        root = QWidget()
        self.setCentralWidget(root)
        main_layout = QHBoxLayout(root)
        main_layout.setContentsMargins(0, 0, 0, 0)

        self.sidebar = QListWidget()
        self.sidebar.setFixedWidth(250)
        self.sidebar.addItems(self.NAV_ITEMS)
        self.sidebar.currentRowChanged.connect(self._on_nav_changed)
        main_layout.addWidget(self.sidebar)

        right_panel = QVBoxLayout()
        right_panel.setContentsMargins(20, 16, 20, 16)

        top_bar = QHBoxLayout()
        self.header_lbl = QLabel("AI Khmer Dubber Pro")
        self.header_lbl.setStyleSheet("font-size: 18px; font-weight: 700;")
        top_bar.addWidget(self.header_lbl)
        top_bar.addStretch()

        self.start_btn = QPushButton("START AUTO DUBBING")
        self.start_btn.setObjectName("PrimaryBtn")
        self.start_btn.clicked.connect(self._start_auto_dubbing)
        top_bar.addWidget(self.start_btn)

        self.export_btn = QPushButton("EXPORT VIDEO")
        self.export_btn.clicked.connect(self._export_current_video)
        top_bar.addWidget(self.export_btn)
        right_panel.addLayout(top_bar)

        self.progress_bar = QProgressBar()
        self.progress_bar.setValue(0)
        self.status_lbl = QLabel("Import a video and configure Gemini & Groq API keys to begin.")
        self.status_lbl.setStyleSheet("color: #94A3B8;")
        right_panel.addWidget(self.status_lbl)
        right_panel.addWidget(self.progress_bar)

        self.stack = QStackedWidget()
        right_panel.addWidget(self.stack, 1)
        main_layout.addLayout(right_panel, 1)

        self._build_pages()
        self.sidebar.setCurrentRow(0)

    def _build_pages(self) -> None:
        # 1. Home
        home = QWidget()
        hl = QVBoxLayout(home)
        hl.addWidget(QLabel("Welcome to AI Khmer Dubber Pro (Windows 10/11)\n\n1. Import a video in any language.\n2. Add Gemini and Groq API keys with automatic rotation.\n3. Click START AUTO DUBBING.\n4. Click EXPORT VIDEO for a synchronized Khmer-dubbed MP4."))
        hl.addStretch()
        self.stack.addWidget(home)

        # 2. Import Video
        imp = QWidget()
        il = QVBoxLayout(imp)
        pick_btn = QPushButton("Select Video File (MP4, MKV, MOV, AVI)")
        pick_btn.setObjectName("PrimaryBtn")
        pick_btn.clicked.connect(self._import_video_dialog)
        self.imported_info = QLabel("No video loaded yet.")
        il.addWidget(pick_btn)
        il.addWidget(self.imported_info)
        il.addStretch()
        self.stack.addWidget(imp)

        # 3 & 4. ASR & Translation Tables
        self.asr_table = QTableWidget(0, 4)
        self.asr_table.setHorizontalHeaderLabels(["Start", "End", "Speaker", "Source Dialogue"])
        self.stack.addWidget(self.asr_table)

        self.tr_table = QTableWidget(0, 4)
        self.tr_table.setHorizontalHeaderLabels(["Speaker", "Emotion", "Source", "Khmer Translation"])
        self.stack.addWidget(self.tr_table)

        # 5-8. Speakers, Voices, Cloning, Emotions
        for label_text in (
            "Speaker Detection assigns consistent character IDs and gender voices automatically.",
            "Voice Management supports Piseth (Male) and Sreymom (Female) Khmer neural voices.",
            "Authorized Voice Cloning lets you register voice samples you own or have permission to use.",
            f"Automatic Emotional Voice Acting supports: {', '.join(EMOTIONS)}",
        ):
            w = QWidget()
            wl = QVBoxLayout(w)
            wl.addWidget(QLabel(label_text))
            if "Cloning" in label_text:
                clone_btn = QPushButton("Upload Authorized Voice Sample (.wav/.mp3)")
                clone_btn.clicked.connect(self._upload_voice_sample)
                wl.addWidget(clone_btn)
            wl.addStretch()
            self.stack.addWidget(w)

        # 9 & 10. Gemini & Groq API Managers
        self.gemini_key_panel = self._create_key_manager_widget("gemini")
        self.groq_key_panel = self._create_key_manager_widget("groq")
        self.stack.addWidget(self.gemini_key_panel)
        self.stack.addWidget(self.groq_key_panel)

        # 11. Audio Sync
        sync_w = QWidget()
        sl = QVBoxLayout(sync_w)
        sl.addWidget(QLabel("Background Audio / Music Volume"))
        self.bgm_slider = QSlider(Qt.Orientation.Horizontal)
        self.bgm_slider.setRange(0, 100)
        self.bgm_slider.setValue(35)
        sl.addWidget(self.bgm_slider)
        sl.addWidget(QLabel("Khmer Dubbing Voice Volume"))
        self.dub_slider = QSlider(Qt.Orientation.Horizontal)
        self.dub_slider.setRange(20, 150)
        self.dub_slider.setValue(100)
        sl.addWidget(self.dub_slider)
        sl.addStretch()
        self.stack.addWidget(sync_w)

        # 12. Video Preview
        prev_w = QWidget()
        pl = QVBoxLayout(prev_w)
        pl.addWidget(QLabel("Run START AUTO DUBBING to mix the Khmer audio track and preview the output."))
        pl.addStretch()
        self.stack.addWidget(prev_w)

        # 13. Export MP4
        exp_w = QWidget()
        el = QVBoxLayout(exp_w)
        self.res_combo = QComboBox()
        self.res_combo.addItems(["1080p", "720p", "4k", "original"])
        self.codec_combo = QComboBox()
        self.codec_combo.addItems(["h264", "h265"])
        self.srt_check = QCheckBox("Also export Khmer .srt subtitles")
        self.srt_check.setChecked(True)
        el.addWidget(QLabel("Resolution"))
        el.addWidget(self.res_combo)
        el.addWidget(QLabel("Video Codec"))
        el.addWidget(self.codec_combo)
        el.addWidget(self.srt_check)
        el.addStretch()
        self.stack.addWidget(exp_w)

        # 14. Project History
        self.history_list = QListWidget()
        self.stack.addWidget(self.history_list)

        # 15. Settings
        set_w = QWidget()
        setl = QVBoxLayout(set_w)
        self.model_combo = QComboBox()
        self.model_combo.addItems(GEMINI_MODELS)
        setl.addWidget(QLabel("Default Gemini Translation Model"))
        setl.addWidget(self.model_combo)
        setl.addWidget(QLabel(f"Default Output Folder: {DEFAULT_EXPORT_DIR}"))
        setl.addStretch()
        self.stack.addWidget(set_w)

    def _create_key_manager_widget(self, provider: str) -> QWidget:
        w = QWidget()
        layout = QVBoxLayout(w)
        row = QHBoxLayout()
        lbl_input = QLineEdit()
        lbl_input.setPlaceholderText("Key Label (e.g. Primary Key)")
        key_input = QLineEdit()
        key_input.setEchoMode(QLineEdit.EchoMode.Password)
        key_input.setPlaceholderText(f"Paste {provider.upper()} API key...")
        add_btn = QPushButton(f"Add {provider.upper()} Key")
        add_btn.setObjectName("PrimaryBtn")
        table = QTableWidget(0, 5)
        table.setHorizontalHeaderLabels(["Label", "Masked Key", "Status", "Usage", "Errors"])

        def refresh() -> None:
            keys = self.db.list_api_keys(provider)
            table.setRowCount(len(keys))
            for r_i, k in enumerate(keys):
                table.setItem(r_i, 0, QTableWidgetItem(k["label"]))
                table.setItem(r_i, 1, QTableWidgetItem(k["key_hint"]))
                table.setItem(r_i, 2, QTableWidgetItem(k["status"]))
                table.setItem(r_i, 3, QTableWidgetItem(str(k["usage_count"])))
                table.setItem(r_i, 4, QTableWidgetItem(str(k["error_count"])))

        def on_add() -> None:
            raw = key_input.text().strip()
            if not raw:
                return
            self.db.add_api_key(provider, lbl_input.text().strip() or f"{provider.upper()} Key", raw)
            key_input.clear()
            lbl_input.clear()
            refresh()

        add_btn.clicked.connect(on_add)
        row.addWidget(lbl_input)
        row.addWidget(key_input, 1)
        row.addWidget(add_btn)
        layout.addLayout(row)
        layout.addWidget(table)
        refresh()
        return w

    def _on_nav_changed(self, row: int) -> None:
        if 0 <= row < self.stack.count():
            self.stack.setCurrentIndex(row)
            self.header_lbl.setText(self.NAV_ITEMS[row])
            if row == 13:
                self.history_list.clear()
                for p in self.db.list_projects():
                    self.history_list.addItem(f"{p['name']} ({p['status']}) — {p['video_path']}")

    def _import_video_dialog(self) -> None:
        file_path, _ = QFileDialog.getOpenFileName(
            self,
            "Import Video",
            str(Path.home()),
            "Video Files (*.mp4 *.mkv *.mov *.avi *.webm)",
        )
        if not file_path:
            return
        p = Path(file_path)
        meta = probe_video(p)
        self.current_project_id = self.db.create_project(
            name=p.stem,
            video_path=str(p),
            duration_sec=meta.duration_sec,
            width=meta.width,
            height=meta.height,
            fps=meta.fps,
        )
        self.imported_info.setText(f"Loaded: {p.name} ({meta.width}x{meta.height} @ {meta.fps}fps, {meta.duration_sec:.1f}s)")
        self.status_lbl.setText(f"Ready: {p.name}")

    def _upload_voice_sample(self) -> None:
        file_path, _ = QFileDialog.getOpenFileName(self, "Select Authorized Voice Sample", str(Path.home()), "Audio (*.wav *.mp3 *.m4a)")
        if not file_path:
            return
        p = Path(file_path)
        register_authorized_voice_sample(self.db, p.stem, "neutral", p)
        QMessageBox.information(self, "Voice Profile Saved", f"Registered authorized voice profile: {p.stem}")

    def _start_auto_dubbing(self) -> None:
        if not self.current_project_id:
            QMessageBox.warning(self, "No Video", "Please import a video first.")
            return
        self.worker = DubbingWorker(self.db, self.rotation, self.current_project_id)
        self.worker.progress.connect(self._on_worker_progress)
        self.worker.finished_ok.connect(self._on_worker_done)
        self.worker.failed.connect(self._on_worker_err)
        self.worker.start()

    def _on_worker_progress(self, pct: int, msg: str) -> None:
        self.progress_bar.setValue(pct)
        self.status_lbl.setText(msg)

    def _on_worker_done(self, _mixed_wav: str) -> None:
        if not self.current_project_id:
            return
        segs = self.db.list_segments(self.current_project_id)
        self.asr_table.setRowCount(len(segs))
        self.tr_table.setRowCount(len(segs))
        for i, s in enumerate(segs):
            self.asr_table.setItem(i, 0, QTableWidgetItem(f"{s['start_time']:.2f}s"))
            self.asr_table.setItem(i, 1, QTableWidgetItem(f"{s['end_time']:.2f}s"))
            self.asr_table.setItem(i, 2, QTableWidgetItem(s["speaker_id"]))
            self.asr_table.setItem(i, 3, QTableWidgetItem(s["source_text"]))

            self.tr_table.setItem(i, 0, QTableWidgetItem(s["speaker_id"]))
            self.tr_table.setItem(i, 1, QTableWidgetItem(s["emotion"]))
            self.tr_table.setItem(i, 2, QTableWidgetItem(s["source_text"]))
            self.tr_table.setItem(i, 3, QTableWidgetItem(s["khmer_text"]))
        QMessageBox.information(self, "Dubbing Complete", "Khmer AI dubbing and audio synchronization finished!")

    def _on_worker_err(self, err: str) -> None:
        self.status_lbl.setText(f"Error: {err}")
        QMessageBox.critical(self, "Pipeline Error", err)

    def _export_current_video(self) -> None:
        if not self.current_project_id:
            QMessageBox.warning(self, "No Project", "Import and dub a video before exporting.")
            return
        proj = self.db.get_project(self.current_project_id)
        if not proj:
            return
        work_dir = PROJECTS_DIR / self.current_project_id
        mixed_wav = work_dir / "mixed_dub.wav"
        if not mixed_wav.exists():
            QMessageBox.warning(self, "Not Dubbed Yet", "Please run START AUTO DUBBING first.")
            return
        out_dir = QFileDialog.getExistingDirectory(self, "Choose Output Folder", str(DEFAULT_EXPORT_DIR))
        if not out_dir:
            return
        res = self.res_combo.currentText()
        codec = self.codec_combo.currentText()
        out_mp4 = Path(out_dir) / f"{proj['name']}_khmer_{res}.mp4"
        export_mp4_video(Path(proj["video_path"]), mixed_wav, out_mp4, float(proj["duration_sec"]), res, codec, self.progress_bar.setValue)
        if self.srt_check.isChecked():
            write_khmer_srt(self.db.list_segments(self.current_project_id), Path(out_dir) / f"{proj['name']}_khmer.srt")
        QMessageBox.information(self, "Export Complete", f"Exported MP4 saved to:\n{out_mp4}")


def main() -> None:
    app = QApplication(sys.argv)
    win = MainWindow()
    win.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
