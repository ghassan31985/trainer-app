// IndexedDB Storage
const DB_NAME = 'TrainerAppDB';
const DB_VERSION = 1;
const STORE_NAME = 'appData';

let db = null;

async function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);

        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME, { keyPath: 'key' });
            }
        };
    });
}

async function dbGet(key) {
    return new Promise((resolve, reject) => {
        if (!db) {
            resolve(null);
            return;
        }
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(key);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            resolve(request.result ? request.result.value : null);
        };
    });
}

async function dbSet(key, value) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('Database not initialized'));
            return;
        }
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put({ key, value });

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
    });
}

async function dbDelete(key) {
    return new Promise((resolve, reject) => {
        if (!db) {
            resolve();
            return;
        }
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(key);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
    });
}

// Data Storage
let courses = [];
let currentCourse = null;

let axes = [];
let trainees = [];
let currentAxis = null;
let currentQuestion = null;
let userAnswer = null;
let questionTimer = null;
let questionTimeLeft = 0;
let currentSelectedTrainee = null;
let selectedTraineesByType = {};
let axisStars = {};
let completedQuestions = {};
const DEFAULT_QUESTION_TIME = 120;
let appMode = 'trainer';

function isPresentationMode() {
    return appMode === 'presentation';
}

function updateModeButtonsUI() {
    const trainerBtn = document.getElementById('trainerModeBtn');
    const presentationBtn = document.getElementById('presentationModeBtn');
    if (trainerBtn) {
        trainerBtn.classList.toggle('active', !isPresentationMode());
    }
    if (presentationBtn) {
        presentationBtn.classList.toggle('active', isPresentationMode());
    }
}

function setAppMode(mode) {
    appMode = mode === 'presentation' ? 'presentation' : 'trainer';
    document.body.classList.toggle('presentation-mode', appMode === 'presentation');
    sessionStorage.setItem('appMode', appMode);
    updateModeButtonsUI();

    if (currentQuestion && currentAxis) {
        const questionIndex = currentAxis.questions.findIndex(q => q.id === currentQuestion.id);
        if (questionIndex !== -1) {
            displayQuestion(questionIndex);
            return;
        }
    }

    if (currentAxis) {
        renderAxisView();
    }
}

// Initialize
async function init() {
    await initDB();
    appMode = sessionStorage.getItem('appMode') === 'presentation' ? 'presentation' : 'trainer';

    courses = await dbGet('trainingCourses') || [];

    // Check if we were on a specific course (session storage?)
    const lastCourseId = sessionStorage.getItem('currentCourseId');
    if (lastCourseId) {
        const course = courses.find(c => c.id === lastCourseId);
        if (course) {
            selectCourse(course.id);
        } else {
            showCourseSelection();
        }
    } else {
        showCourseSelection();
    }

    setAppMode(appMode);
}

function showCourseSelection() {
    currentCourse = null;
    sessionStorage.removeItem('currentCourseId');
    axes = [];
    trainees = [];
    axisStars = {};
    completedQuestions = {};

    document.getElementById('axesList').innerHTML = '';
    document.querySelector('.sidebar-header h1').textContent = '🎓 نظام المدرب';

    document.getElementById('mainContent').innerHTML = `
        <div class="courses-selector">
            <h2 style="color: white; margin-bottom: 30px; font-size: 32px; text-align: center;">📚 الدورات التدريبية المتاحة</h2>
            <div class="courses-grid" id="coursesGrid"></div>
            <div style="text-align: center; margin-top: 40px;">
                <button class="btn btn-primary btn-large" style="font-size: 24px; padding: 20px 40px;" onclick="openCourseModal(true)">➕ إنشاء دورة تدريبية جديدة</button>
            </div>
        </div>
    `;

    renderCoursesGrid();
}

function renderCoursesGrid() {
    const grid = document.getElementById('coursesGrid');
    if (!grid) return;

    if (courses.length === 0) {
        grid.innerHTML = '<p style="color: rgba(255,255,255,0.6); text-align: center; grid-column: span 3; font-size: 20px;">لا يوجد دورات حالياً. اضغط "إنشاء دورة جديدة" للبدء.</p>';
        return;
    }

    const escapeHtml = (text) => String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const formatDate = (dateValue) => {
        if (!dateValue) return '--';
        const parsed = new Date(dateValue);
        if (Number.isNaN(parsed.getTime())) return dateValue;
        return parsed.toLocaleDateString('ar-SY', { year: 'numeric', month: 'short', day: 'numeric' });
    };

    grid.innerHTML = courses.map(course => {
        const safeName = escapeHtml(course.name || 'دورة تدريبية');
        const safeTrainer = escapeHtml(course.trainer || 'غير محدد');
        const safeOrganizer = escapeHtml(course.organizer || 'غير محدد');
        const safeDescription = escapeHtml(course.description || 'لا يوجد وصف للدورة.');
        const startDate = formatDate(course.startDate);
        const endDate = formatDate(course.endDate);
        const axesCount = course.axes ? course.axes.length : 0;
        const traineesCount = course.trainees ? course.trainees.length : 0;

        return `
            <div class="course-card" onclick="selectCourse('${course.id}')">
                <div class="course-card-header">
                    <h3>${safeName}</h3>
                    <div class="course-card-actions">
                        <button class="btn-icon" title="تعديل الدورة" onclick="event.stopPropagation(); editCourse('${course.id}')">✏️</button>
                        <button class="btn-icon danger" title="حذف الدورة" onclick="event.stopPropagation(); deleteCourse('${course.id}')">🗑️</button>
                    </div>
                </div>
                <div class="course-card-body">
                    <p class="course-meta-line"><span>👤 المدرب</span><strong>${safeTrainer}</strong></p>
                    <p class="course-meta-line"><span>🏢 الجهة</span><strong>${safeOrganizer}</strong></p>
                    <p class="course-meta-line"><span>📅 المدة</span><strong>${startDate}${course.endDate ? ` - ${endDate}` : ''}</strong></p>
                    <p class="course-description">${safeDescription}</p>
                </div>
                <div class="course-card-footer">
                    <span class="course-badge">📊 ${axesCount} محاور</span>
                    <span class="course-badge">👥 ${traineesCount} متدربين</span>
                </div>
            </div>
        `;
    }).join('');
}

async function selectCourse(courseId) {
    currentCourse = courses.find(c => c.id === courseId);
    if (!currentCourse) return;

    sessionStorage.setItem('currentCourseId', courseId);

    // Load course data into working variables
    axes = currentCourse.axes || [];
    trainees = currentCourse.trainees || [];
    axisStars = currentCourse.axisStars || {};
    completedQuestions = currentCourse.completedQuestions || {};

    updateHeaderWithCourseName();
    renderAxesList();
    renderTraineesList();
    showWelcomeScreen();
}

function updateHeaderWithCourseName() {
    if (currentCourse && currentCourse.name) {
        const sidebarTitle = document.querySelector('.sidebar-header h1');
        if (sidebarTitle) sidebarTitle.textContent = currentCourse.name;
    }
}

function openSettingsModal() {
    document.getElementById('settingsModal').classList.add('active');
}

function openCourseModal(isNew = false) {
    document.getElementById('courseModal').classList.add('active');

    if (isNew) {
        document.getElementById('courseName').value = '';
        document.getElementById('courseStartDate').value = '';
        document.getElementById('courseEndDate').value = '';
        document.getElementById('courseTrainer').value = '';
        document.getElementById('courseOrganizer').value = '';
        document.getElementById('courseDescription').value = '';
        document.getElementById('courseModal').dataset.mode = 'new';
    } else {
        document.getElementById('courseName').value = currentCourse.name || '';
        document.getElementById('courseStartDate').value = currentCourse.startDate || '';
        document.getElementById('courseEndDate').value = currentCourse.endDate || '';
        document.getElementById('courseTrainer').value = currentCourse.trainer || '';
        document.getElementById('courseOrganizer').value = currentCourse.organizer || '';
        document.getElementById('courseDescription').value = currentCourse.description || '';
        document.getElementById('courseModal').dataset.mode = 'edit';
    }
}

function editCourse(courseId) {
    currentCourse = courses.find(c => c.id === courseId);
    openCourseModal(false);
}

async function saveCourseData() {
    const name = document.getElementById('courseName').value.trim();
    const startDate = document.getElementById('courseStartDate').value;
    const mode = document.getElementById('courseModal').dataset.mode;

    if (!name || !startDate) {
        alert('الرجاء إدخال اسم الدورة وتاريخ البداية');
        return;
    }

    if (mode === 'new') {
        const newCourse = {
            id: 'course_' + Date.now(),
            name,
            startDate,
            endDate: document.getElementById('courseEndDate').value,
            trainer: document.getElementById('courseTrainer').value.trim(),
            organizer: document.getElementById('courseOrganizer').value.trim(),
            description: document.getElementById('courseDescription').value.trim(),
            axes: [],
            trainees: [],
            axisStars: {},
            completedQuestions: {}
        };
        courses.push(newCourse);
    } else {
        currentCourse.name = name;
        currentCourse.startDate = startDate;
        currentCourse.endDate = document.getElementById('courseEndDate').value;
        currentCourse.trainer = document.getElementById('courseTrainer').value.trim();
        currentCourse.organizer = document.getElementById('courseOrganizer').value.trim();
        currentCourse.description = document.getElementById('courseDescription').value.trim();

        const idx = courses.findIndex(c => c.id === currentCourse.id);
        courses[idx] = currentCourse;
    }

    await dbSet('trainingCourses', courses);
    closeModal('courseModal');

    if (currentCourse) {
        updateHeaderWithCourseName();
        renderAxesList();
    } else {
        showCourseSelection();
    }
    alert('✅ تم حفظ بيانات الدورة بنجاح');
}

async function deleteCourse(courseId) {
    if (!confirm('⚠️ هل أنت متأكد من حذف هذه الدورة بالكامل بجميع محاورها وبياناتها؟')) return;

    courses = courses.filter(c => c.id !== courseId);
    await dbSet('trainingCourses', courses);

    if (sessionStorage.getItem('currentCourseId') === courseId) {
        sessionStorage.removeItem('currentCourseId');
    }

    showCourseSelection();
}

async function syncCurrentCourse() {
    if (!currentCourse) return;

    currentCourse.axes = axes;
    currentCourse.trainees = trainees;
    currentCourse.axisStars = axisStars;
    currentCourse.completedQuestions = completedQuestions;

    const idx = courses.findIndex(c => c.id === currentCourse.id);
    if (idx !== -1) {
        courses[idx] = currentCourse;
        await dbSet('trainingCourses', courses);
    }
}

// Axes Management
function openAxisModal() {
    document.getElementById('axisModal').classList.add('active');
    document.getElementById('axisTitle').value = '';
}

async function saveAxis() {
    const title = document.getElementById('axisTitle').value.trim();
    if (!title) {
        alert('الرجاء إدخال عنوان المحور');
        return;
    }

    const newAxis = {
        id: Date.now(),
        title: title,
        questions: []
    };

    axes.push(newAxis);
    await syncCurrentCourse();
    closeModal('axisModal');
    renderAxesList();
}

async function deleteAxis(axisId) {
    if (!confirm('هل أنت متأكد من حذف هذا المحور؟')) return;

    axes = axes.filter(axis => axis.id !== axisId);
    await syncCurrentCourse();
    renderAxesList();

    if (currentAxis && currentAxis.id === axisId) {
        showWelcomeScreen();
    }
}

function selectAxis(axisId) {
    currentAxis = axes.find(axis => axis.id === axisId);
    selectedTraineesByType = {};
    currentSelectedTrainee = null;
    stopQuestionTimer();
    renderAxisView();
}

function renderAxesList() {
    const container = document.getElementById('axesList');
    if (axes.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #94a3b8; padding: 20px;">لا توجد محاور حتى الآن</p>';
        return;
    }

    container.innerHTML = axes.map(axis => `
        <div class="axis-item ${currentAxis && currentAxis.id === axis.id ? 'active' : ''}" onclick="selectAxis(${axis.id})">
            <h3>${axis.title}</h3>
            <p>📝 ${axis.questions.length} سؤال</p>
            <div class="axis-actions">
                <button class="btn btn-primary btn-small" onclick="event.stopPropagation(); openQuestionModal(${axis.id})">➕ سؤال</button>
                <button class="btn btn-secondary btn-small" onclick="event.stopPropagation(); deleteAxis(${axis.id})">🗑️ حذف</button>
            </div>
        </div>
    `).join('');
}

function renderAxisView() {
    if (isPresentationMode()) {
        if (!currentAxis || currentAxis.questions.length === 0) {
            document.getElementById('mainContent').innerHTML = `
                <div class="welcome-screen">
                    <h2>📺 وضع العرض</h2>
                    <p>لا توجد أسئلة متاحة في هذا المحور حالياً.</p>
                    <button class="btn btn-primary btn-large" style="margin-top: 20px;" onclick="setAppMode('trainer')">🎤 العودة لوضع المدرب</button>
                </div>
            `;
            return;
        }

        document.getElementById('mainContent').innerHTML = `
            <div class="presentation-questions-view">
                <h2>📺 ${currentAxis.title}</h2>
                <p>جميع الأسئلة المتاحة في هذا المحور (${currentAxis.questions.length})</p>
                <div class="presentation-questions-list">
                    ${currentAxis.questions.map((q, index) => `
                        <div class="presentation-question-card">
                            <div class="presentation-question-meta">السؤال ${index + 1} - ${getQuestionTypeName(q.type)}</div>
                            <div class="presentation-question-text">${q.text}</div>
                            <button class="btn btn-primary" onclick="displayQuestion(${index})">▶️ عرض السؤال</button>
                        </div>
                    `).join('')}
                </div>
                <button class="btn btn-secondary btn-large" style="margin-top: 20px;" onclick="setAppMode('trainer')">🎤 العودة لوضع المدرب</button>
            </div>
        `;
        return;
    }

    if (!currentAxis || currentAxis.questions.length === 0) {
        document.getElementById('mainContent').innerHTML = `
            <div class="welcome-screen">
                <h2>${currentAxis ? currentAxis.title : 'مرحباً'}</h2>
                <p>لا توجد أسئلة في هذا المحور بعد</p>
                <button class="btn btn-primary btn-large" style="margin-top: 30px;" onclick="openQuestionModal(${currentAxis.id})">➕ أضف أول سؤال</button>
            </div>
        `;
        return;
    }

    const stars = axisStars[currentAxis.id] || {};
    const totalStars = Object.values(stars).reduce((a, b) => a + b, 0);
    const hasStars = totalStars > 0;
    const completed = completedQuestions[currentAxis.id] || [];
    const completedCount = completed.length;

    document.getElementById('mainContent').innerHTML = `
        <div class="welcome-screen">
            <h2>${currentAxis.title}</h2>
            <p>يحتوي على ${currentAxis.questions.length} سؤال ${completedCount > 0 ? `(${completedCount} مكتمل ✅)` : ''}</p>
            <div class="axis-buttons">
                ${currentAxis.questions.map((q, index) => {
        const isCompleted = completed.includes(q.id);
        const btnClass = isCompleted ? 'btn btn-completed btn-large' : 'btn btn-primary btn-large';
        const statusText = isCompleted ? '✅ مكتمل' : '';
        return `<button class="${btnClass}" style="margin: 10px;" onclick="displayQuestion(${index})" ${isCompleted ? 'disabled' : ''}>
                        السؤال ${index + 1}: ${getQuestionTypeName(q.type)} ${statusText}
                    </button>`;
    }).join('')}
            </div>
            ${hasStars ? '<button class="btn btn-star btn-large" style="margin-top: 20px;" onclick="showLeaderboard()">🏆 عرض الترتيب</button>' : ''}
            ${completedCount > 0 ? `<button class="btn btn-secondary btn-large" style="margin-top: 15px;" onclick="resetCompletedQuestions()">🔄 إعادة الأسئلة</button>` : ''}
        </div>
    `;
}

// Question Management
function openQuestionModal(axisId, editQuestion = null) {
    currentAxis = axes.find(axis => axis.id === axisId);
    document.getElementById('questionModal').classList.add('active');

    const modalTitle = document.getElementById('questionModalTitle');
    editingQuestionId = editQuestion ? editQuestion.id : null;

    if (editQuestion) {
        modalTitle.textContent = 'تعديل السؤال';
        document.getElementById('questionType').value = editQuestion.type;
        document.getElementById('questionText').value = editQuestion.text;
        updateQuestionForm(editQuestion);
    } else {
        modalTitle.textContent = 'إضافة سؤال جديد';
        document.getElementById('questionText').value = '';
        updateQuestionForm();
    }
}

function updateQuestionForm(editQuestion = null) {
    const type = document.getElementById('questionType').value;
    const container = document.getElementById('questionFormContainer');

    if (type === 'truefalse') {
        container.innerHTML = `
            <div class="form-group">
                <label>الإجابة الصحيحة</label>
                <select id="correctAnswer">
                    <option value="true">صح ✓</option>
                    <option value="false">خطأ ✗</option>
                </select>
            </div>
        `;
        if (editQuestion && editQuestion.type === 'truefalse') {
            document.getElementById('correctAnswer').value = editQuestion.correctAnswer.toString();
        }
    } else if (type === 'multiple') {
        container.innerHTML = `
            <div class="form-group">
                <label>الخيارات (اختر الإجابة الصحيحة)</label>
                <div id="optionsContainer">
                    <div class="option-input-group">
                        <input type="radio" name="correctOption" value="0">
                        <input type="text" placeholder="الخيار 1">
                    </div>
                    <div class="option-input-group">
                        <input type="radio" name="correctOption" value="1">
                        <input type="text" placeholder="الخيار 2">
                    </div>
                </div>
                <button class="btn btn-add" onclick="addOption()">➕ إضافة خيار</button>
            </div>
        `;
        if (editQuestion && editQuestion.type === 'multiple') {
            const optionsContainer = document.getElementById('optionsContainer');
            optionsContainer.innerHTML = '';
            editQuestion.options.forEach((opt, i) => {
                const div = document.createElement('div');
                div.className = 'option-input-group';
                div.innerHTML = `
                    <input type="radio" name="correctOption" value="${i}" ${i === editQuestion.correctAnswer ? 'checked' : ''}>
                    <input type="text" placeholder="الخيار ${i + 1}" value="${opt}">
                `;
                optionsContainer.appendChild(div);
            });
        }
    } else if (type === 'matching') {
        container.innerHTML = `
            <div class="form-group">
                <label>العمود الأول</label>
                <textarea id="column1" placeholder="اكتب العناصر مفصولة بسطر جديد"></textarea>
            </div>
            <div class="form-group">
                <label>العمود الثاني (المطابق)</label>
                <textarea id="column2" placeholder="اكتب العناصر المطابقة بنفس الترتيب"></textarea>
            </div>
        `;
        if (editQuestion && editQuestion.type === 'matching') {
            document.getElementById('column1').value = editQuestion.column1.join('\n');
            document.getElementById('column2').value = editQuestion.column2.join('\n');
        }
    } else if (type === 'essay') {
        container.innerHTML = `
            <div class="form-group">
                <label>الإجابة النموذجية</label>
                <textarea id="modelAnswer" placeholder="اكتب الإجابة النموذجية..."></textarea>
            </div>
        `;
        if (editQuestion && editQuestion.type === 'essay') {
            document.getElementById('modelAnswer').value = editQuestion.modelAnswer;
        }
    } else if (type === 'scenario') {
        container.innerHTML = `
            <div class="form-group">
                <label>السيناريو</label>
                <textarea id="scenarioText" placeholder="اكتب السيناريو هنا..."></textarea>
            </div>
            <div class="form-group">
                <label>الخيارات (اختر الإجابة الصحيحة)</label>
                <div id="optionsContainer">
                    <div class="option-input-group">
                        <input type="radio" name="correctOption" value="0">
                        <input type="text" placeholder="الخيار 1">
                    </div>
                    <div class="option-input-group">
                        <input type="radio" name="correctOption" value="1">
                        <input type="text" placeholder="الخيار 2">
                    </div>
                </div>
                <button class="btn btn-add" onclick="addOption()">➕ إضافة خيار</button>
            </div>
            <div class="form-group">
                <label>المبرر (Justification)</label>
                <textarea id="justification" placeholder="اكتب المبرر هنا..."></textarea>
            </div>
        `;
        if (editQuestion && editQuestion.type === 'scenario') {
            document.getElementById('scenarioText').value = editQuestion.scenario;
            document.getElementById('justification').value = editQuestion.justification;
            const optionsContainer = document.getElementById('optionsContainer');
            optionsContainer.innerHTML = '';
            editQuestion.options.forEach((opt, i) => {
                const div = document.createElement('div');
                div.className = 'option-input-group';
                div.innerHTML = `
                    <input type="radio" name="correctOption" value="${i}" ${i === editQuestion.correctAnswer ? 'checked' : ''}>
                    <input type="text" placeholder="الخيار ${i + 1}" value="${opt}">
                `;
                optionsContainer.appendChild(div);
            });
        }
    } else if (type === 'casestudy') {
        container.innerHTML = `
            <div class="form-group">
                <label>السياق (Context)</label>
                <textarea id="caseContext" placeholder="اكتب سياق الحالة الدراسية هنا..."></textarea>
            </div>
            <div class="form-group">
                <label>المطلوب (Requirements)</label>
                <textarea id="caseRequirements" placeholder="حدد المطلوب من المتدرب..."></textarea>
            </div>
            <div class="form-group">
                <label>الإجابات النموذجية (Model Answers)</label>
                <textarea id="modelAnswer" placeholder="اكتب الإجابات النموذجية هنا..."></textarea>
            </div>
        `;
        if (editQuestion && editQuestion.type === 'casestudy') {
            document.getElementById('caseContext').value = editQuestion.context;
            document.getElementById('caseRequirements').value = editQuestion.requirements;
            document.getElementById('modelAnswer').value = editQuestion.modelAnswer;
        }
    } else if (type === 'roleplay') {
        container.innerHTML = `
            <div class="form-group">
                <label>وصف الحالة/المشهد</label>
                <textarea id="roleplayScenario" placeholder="اكتب وصف المشهد أو الحالة هنا..."></textarea>
            </div>
            <div class="form-group">
                <label>الأدوار المطلوبة</label>
                <div id="rolesContainer">
                    <div class="option-input-group">
                        <input type="text" placeholder="اسم الدور (مثال: المدير)">
                    </div>
                    <div class="option-input-group">
                        <input type="text" placeholder="اسم الدور (مثال: العميل)">
                    </div>
                </div>
                <button class="btn btn-add" onclick="addRoleInput()">➕ إضافة دور</button>
            </div>
        `;
        if (editQuestion && editQuestion.type === 'roleplay') {
            document.getElementById('roleplayScenario').value = editQuestion.scenario;
            const rolesContainer = document.getElementById('rolesContainer');
            rolesContainer.innerHTML = '';
            editQuestion.roles.forEach((role, i) => {
                const div = document.createElement('div');
                div.className = 'option-input-group';
                div.innerHTML = `<input type="text" placeholder="اسم الدور (مثال: الدور ${i + 1})" value="${role}">`;
                rolesContainer.appendChild(div);
            });
        }
    } else if (type === 'finderrors') {
        container.innerHTML = `
            <div class="form-group">
                <label>النموذج (الذي يحتوي على الأخطاء)</label>
                <textarea id="errorModel" placeholder="اكتب النص أو النموذج هنا..."></textarea>
            </div>
            <div class="form-group">
                <label>الأخطاء المحددة (والتي يجب اكتشافها)</label>
                <div id="errorsContainer">
                    <div class="option-input-group">
                        <input type="text" placeholder="الخطأ 1">
                    </div>
                    <div class="option-input-group">
                        <input type="text" placeholder="الخطأ 2">
                    </div>
                </div>
                <button class="btn btn-add" onclick="addErrorInput()">➕ إضافة خطأ</button>
            </div>
        `;
        if (editQuestion && editQuestion.type === 'finderrors') {
            document.getElementById('errorModel').value = editQuestion.model;
            const errorsContainer = document.getElementById('errorsContainer');
            errorsContainer.innerHTML = '';
            editQuestion.errors.forEach((err, i) => {
                const div = document.createElement('div');
                div.className = 'option-input-group';
                div.innerHTML = `<input type="text" placeholder="الخطأ ${i + 1}" value="${err}">`;
                errorsContainer.appendChild(div);
            });
        }
    } else if (type === 'traineecards') {
        container.innerHTML = `
            <div id="cardsListContainer">
                <div class="card-entry" style="border: 1px solid var(--border); padding: 15px; border-radius: 12px; margin-bottom: 15px; background: #f8fafc;">
                    <div class="form-group">
                        <label>السؤال / وجه البطاقة</label>
                        <input type="text" class="card-q-input" placeholder="اكتب السؤال هنا...">
                    </div>
                    <div class="form-group">
                        <label>الإجابة / ظهر البطاقة</label>
                        <textarea class="card-a-input" placeholder="اكتب الإجابة هنا..." style="min-height: 80px;"></textarea>
                    </div>
                </div>
            </div>
            <button class="btn btn-add" onclick="addCardInput()">➕ إضافة بطاقة أخرى</button>
        `;
        if (editQuestion && editQuestion.type === 'traineecards' && editQuestion.cards) {
            const listContainer = document.getElementById('cardsListContainer');
            listContainer.innerHTML = '';
            editQuestion.cards.forEach((card, i) => {
                const div = document.createElement('div');
                div.className = 'card-entry';
                div.style = 'border: 1px solid var(--border); padding: 15px; border-radius: 12px; margin-bottom: 15px; background: #f8fafc; position: relative;';
                div.innerHTML = `
                    <button type="button" style="position: absolute; left: 10px; top: 10px; background: var(--error); color: white; border: none; border-radius: 5px; padding: 2px 8px; cursor: pointer;" onclick="this.parentElement.remove()">X</button>
                    <div class="form-group">
                        <label>السؤال / وجه البطاقة ${i + 1}</label>
                        <input type="text" class="card-q-input" placeholder="اكتب السؤال هنا..." value="${card.q}">
                    </div>
                    <div class="form-group">
                        <label>الإجابة / ظهر البطاقة ${i + 1}</label>
                        <textarea class="card-a-input" placeholder="اكتب الإجابة هنا..." style="min-height: 80px;">${card.a}</textarea>
                    </div>
                `;
                listContainer.appendChild(div);
            });
        }
    }
}

function addCardInput() {
    const listContainer = document.getElementById('cardsListContainer');
    const index = listContainer.children.length + 1;
    const div = document.createElement('div');
    div.className = 'card-entry';
    div.style = 'border: 1px solid var(--border); padding: 15px; border-radius: 12px; margin-bottom: 15px; background: #f8fafc; position: relative;';
    div.innerHTML = `
        <button type="button" style="position: absolute; left: 10px; top: 10px; background: var(--error); color: white; border: none; border-radius: 5px; padding: 2px 8px; cursor: pointer;" onclick="this.parentElement.remove()">X</button>
        <div class="form-group">
            <label>السؤال / وجه البطاقة ${index}</label>
            <input type="text" class="card-q-input" placeholder="اكتب السؤال هنا...">
        </div>
        <div class="form-group">
            <label>الإجابة / ظهر البطاقة ${index}</label>
            <textarea class="card-a-input" placeholder="اكتب الإجابة هنا..." style="min-height: 80px;"></textarea>
        </div>
    `;
    listContainer.appendChild(div);
}

function addErrorInput() {
    const container = document.getElementById('errorsContainer');
    const div = document.createElement('div');
    div.className = 'option-input-group';
    div.innerHTML = `<input type="text" placeholder="الخطأ ${container.children.length + 1}">`;
    container.appendChild(div);
}

function addRoleInput() {
    const container = document.getElementById('rolesContainer');
    const div = document.createElement('div');
    div.className = 'option-input-group';
    div.innerHTML = `<input type="text" placeholder="اسم الدور (مثال: الدور ${container.children.length + 1})">`;
    container.appendChild(div);
}

function addOption() {
    const container = document.getElementById('optionsContainer');
    const index = container.children.length;
    const newOption = document.createElement('div');
    newOption.className = 'option-input-group';
    newOption.innerHTML = `
        <input type="radio" name="correctOption" value="${index}">
        <input type="text" placeholder="الخيار ${index + 1}">
    `;
    container.appendChild(newOption);
}

async function saveQuestion() {
    const type = document.getElementById('questionType').value;
    const text = document.getElementById('questionText').value.trim();

    if (!text) {
        alert('الرجاء إدخال نص السؤال');
        return;
    }

    const question = {
        id: Date.now(),
        type: type,
        text: text
    };

    if (type === 'truefalse') {
        question.correctAnswer = document.getElementById('correctAnswer').value === 'true';
    } else if (type === 'multiple') {
        const options = Array.from(document.querySelectorAll('#optionsContainer input[type="text"]'))
            .map(input => input.value.trim())
            .filter(val => val);
        const correct = document.querySelector('input[name="correctOption"]:checked');

        if (options.length < 2 || !correct) {
            alert('الرجاء إضافة خيارين على الأقل واختيار الإجابة الصحيحة');
            return;
        }

        question.options = options;
        question.correctAnswer = parseInt(correct.value);
    } else if (type === 'matching') {
        const col1 = document.getElementById('column1').value.trim().split('\n').filter(x => x);
        const col2 = document.getElementById('column2').value.trim().split('\n').filter(x => x);

        if (col1.length < 2 || col2.length < 2 || col1.length !== col2.length) {
            alert('الرجاء إدخال عناصر متساوية في العمودين (2 على الأقل)');
            return;
        }

        question.column1 = col1;
        question.column2 = col2;
    } else if (type === 'essay') {
        const modelAnswer = document.getElementById('modelAnswer').value.trim();
        if (!modelAnswer) {
            alert('الرجاء إدخال الإجابة النموذجية');
            return;
        }
        question.modelAnswer = modelAnswer;
    } else if (type === 'scenario') {
        const scenario = document.getElementById('scenarioText').value.trim();
        const justification = document.getElementById('justification').value.trim();
        const options = Array.from(document.querySelectorAll('#optionsContainer input[type="text"]'))
            .map(input => input.value.trim())
            .filter(val => val);
        const correct = document.querySelector('input[name="correctOption"]:checked');

        if (!scenario || options.length < 2 || !correct || !justification) {
            alert('الرجاء إكمال جميع الحقول: السيناريو، خيارين على الأقل مع تحديد الإجابة الصحيحة، والمبرر');
            return;
        }

        question.scenario = scenario;
        question.options = options;
        question.correctAnswer = parseInt(correct.value);
        question.justification = justification;
    } else if (type === 'casestudy') {
        const context = document.getElementById('caseContext').value.trim();
        const requirements = document.getElementById('caseRequirements').value.trim();
        const modelAnswer = document.getElementById('modelAnswer').value.trim();

        if (!context || !requirements || !modelAnswer) {
            alert('الرجاء إكمال جميع الحقول: السياق، المطلوب، والإجابة النموذجية');
            return;
        }

        question.context = context;
        question.requirements = requirements;
        question.modelAnswer = modelAnswer;
    } else if (type === 'roleplay') {
        const scenario = document.getElementById('roleplayScenario').value.trim();
        const roles = Array.from(document.querySelectorAll('#rolesContainer input[type="text"]'))
            .map(input => input.value.trim())
            .filter(val => val);

        if (!scenario || roles.length < 2) {
            alert('الرجاء إكمال وصف الحالة وإضافة دورين على الأقل');
            return;
        }

        question.scenario = scenario;
        question.roles = roles;
    } else if (type === 'finderrors') {
        const model = document.getElementById('errorModel').value.trim();
        const errors = Array.from(document.querySelectorAll('#errorsContainer input[type="text"]'))
            .map(input => input.value.trim())
            .filter(val => val);

        if (!model || errors.length < 1) {
            alert('الرجاء إكمال النموذج وإضافة خطأ واحد على الأقل');
            return;
        }

        question.model = model;
        question.errors = errors;
    } else if (type === 'traineecards') {
        const questions = Array.from(document.querySelectorAll('.card-q-input')).map(el => el.value.trim());
        const answers = Array.from(document.querySelectorAll('.card-a-input')).map(el => el.value.trim());

        const cards = [];
        for (let i = 0; i < questions.length; i++) {
            if (questions[i] && answers[i]) {
                cards.push({ q: questions[i], a: answers[i] });
            }
        }

        if (cards.length < 1) {
            alert('الرجاء إضافة بطاقة واحدة على الأقل تحتوي على سؤال وجواب');
            return;
        }
        question.cards = cards;
        question.text = 'نشاط بطاقات المتدربين العشوائية'; // Placeholder title
    }

    if (editingQuestionId) {
        const questionIndex = currentAxis.questions.findIndex(q => q.id === editingQuestionId);
        if (questionIndex !== -1) {
            currentAxis.questions[questionIndex] = question;
        }
    } else {
        currentAxis.questions.push(question);
    }

    axes = axes.map(axis => axis.id === currentAxis.id ? currentAxis : axis);
    await syncCurrentCourse();

    editingQuestionId = null;
    closeModal('questionModal');
    renderAxisView();
    renderAxesList();
}

function editCurrentQuestion() {
    if (!currentQuestion || !currentAxis) return;

    editingQuestionId = currentQuestion.id;
    openQuestionModal(currentAxis.id, currentQuestion);
}

async function deleteCurrentQuestion() {
    if (!currentQuestion || !currentAxis) return;

    if (!confirm('هل أنت متأكد من حذف هذا السؤال؟')) return;

    currentAxis.questions = currentAxis.questions.filter(q => q.id !== currentQuestion.id);
    axes = axes.map(axis => axis.id === currentAxis.id ? currentAxis : axis);
    await syncCurrentCourse();

    currentQuestion = null;
    renderAxisView();
    renderAxesList();
}

function displayQuestion(index) {
    currentQuestion = currentAxis.questions[index];
    userAnswer = null;
    stopQuestionTimer();

    let html = `
        <div class="question-display">
            <div class="question-header">
                <span class="question-type-badge">${getQuestionTypeName(currentQuestion.type)}</span>
                <h2 class="question-text">${currentQuestion.text}</h2>
            </div>
            <div id="timerContainer"></div>
    `;

    if (currentQuestion.type === 'truefalse') {
        html += `
            <div class="options-container">
                <div class="option" onclick="selectOption(true)">✓ صح</div>
                <div class="option" onclick="selectOption(false)">✗ خطأ</div>
            </div>
        `;
    } else if (currentQuestion.type === 'multiple') {
        html += `<div class="options-container">`;
        currentQuestion.options.forEach((option, i) => {
            html += `<div class="option" onclick="selectOption(${i})">
                <span style="font-weight: 800; color: var(--primary);">${String.fromCharCode(65 + i)}.</span> ${option}
            </div>`;
        });
        html += `</div>`;
    } else if (currentQuestion.type === 'matching') {
        html += `
            <div class="matching-container">
                <div class="matching-column"><h3>العمود الأول</h3>
                    ${currentQuestion.column1.map((item, i) => `<div class="matching-item">${i + 1}. ${item}</div>`).join('')}
                </div>
                <div class="matching-column"><h3>العمود الثاني</h3>
                    ${currentQuestion.column2.map((item, i) => `<div class="matching-item">${String.fromCharCode(65 + i)}. ${item}</div>`).join('')}
                </div>
            </div>
        `;
    } else if (currentQuestion.type === 'essay') {
        html += `<div class="essay-answer" style="display: none;" id="essayAnswer">
            <strong style="color: var(--primary); font-size: 28px; display: block; margin-bottom: 15px;">💡 الإجابة النموذجية:</strong>
            ${currentQuestion.modelAnswer}
        </div>`;
    } else if (currentQuestion.type === 'scenario') {
        html += `
            <div class="scenario-box">
                <strong style="color: var(--primary); font-size: 20px; display: block; margin-bottom: 10px;">📄 السيناريو:</strong>
                <p style="font-size: 1.1rem; line-height: 1.6; margin-bottom: 20px;">${currentQuestion.scenario}</p>
            </div>
            <div class="options-container">`;
        currentQuestion.options.forEach((option, i) => {
            html += `<div class="option" onclick="selectOption(${i})">
                <span style="font-weight: 800; color: var(--primary);">${String.fromCharCode(65 + i)}.</span> ${option}
            </div>`;
        });
        html += `</div>
            <div class="essay-answer" style="display: none;" id="justificationAnswer">
                <strong style="color: var(--primary); font-size: 28px; display: block; margin-bottom: 15px;">💡 المبرر:</strong>
                ${currentQuestion.justification}
            </div>`;
    } else if (currentQuestion.type === 'casestudy') {
        html += `
            <div class="scenario-box">
                <strong style="color: var(--primary); font-size: 20px; display: block; margin-bottom: 10px;">📄 سياق الحالة:</strong>
                <p style="font-size: 1.1rem; line-height: 1.6; margin-bottom: 20px;">${currentQuestion.context}</p>
            </div>
            <div class="scenario-box" style="border-right-color: var(--secondary); background: linear-gradient(135deg, rgba(56, 189, 248, 0.05) 0%, rgba(14, 165, 233, 0.05) 100%);">
                <strong style="color: var(--secondary); font-size: 20px; display: block; margin-bottom: 10px;">🎯 المطلوب:</strong>
                <p style="font-size: 1.1rem; line-height: 1.6;">${currentQuestion.requirements}</p>
            </div>
            <div class="essay-answer" style="display: none;" id="caseModelAnswer">
                <strong style="color: var(--primary); font-size: 28px; display: block; margin-bottom: 15px;">💡 الإجابة النموذجية:</strong>
                ${currentQuestion.modelAnswer}
            </div>`;
    } else if (currentQuestion.type === 'roleplay') {
        html += `
            <div class="scenario-box">
                <strong style="color: var(--primary); font-size: 20px; display: block; margin-bottom: 10px;">🎭 حالة لعب الأدوار:</strong>
                <p style="font-size: 1.1rem; line-height: 1.6; margin-bottom: 20px;">${currentQuestion.scenario}</p>
            </div>
            <div class="roles-display">
                <h3 style="color: var(--primary); margin-bottom: 20px;">👥 الأدوار المحددة:</h3>
                <div class="roles-grid">
                    ${currentQuestion.roles.map(role => `
                        <div class="role-card">
                            <div class="role-name-tag">🎭 ${role}</div>
                            <div class="assigned-name" id="role-${role.replace(/\s+/g, '-')}">-- في انتظار التوزيع --</div>
                        </div>
                    `).join('')}
                </div>
                <button class="btn btn-star btn-large" style="margin-top: 30px;" onclick="distributeRoles()">🎲 توزيع الأدوار عشوائياً</button>
            </div>
        `;
    } else if (currentQuestion.type === 'finderrors') {
        html += `
            <div class="scenario-box" style="border-right-color: var(--error);">
                <strong style="color: var(--error); font-size: 20px; display: block; margin-bottom: 10px;">🔍 ابحث عن الأخطاء في النموذج التالي:</strong>
                <p style="font-size: 1.2rem; line-height: 1.8; white-space: pre-wrap;">${currentQuestion.model}</p>
            </div>
            <div class="essay-answer" style="display: none;" id="errorsListDisplay">
                <strong style="color: var(--error); font-size: 28px; display: block; margin-bottom: 15px;">🚩 الأخطاء الموجودة:</strong>
                <ul style="list-style-type: none; padding: 0;">
                    ${currentQuestion.errors.map(err => `<li style="margin-bottom: 10px; font-size: 1.4rem;">❌ ${err}</li>`).join('')}
                </ul>
            </div>`;
    } else if (currentQuestion.type === 'traineecards') {
        html += `
            <div class="trainee-cards-container">
                <div id="cardsPickerUI" class="cards-picker-ui">
                    <div class="deck-visual">🗃️</div>
                    <h3>لديك ${currentQuestion.cards.length} بطاقة تدريبية</h3>
                    <button class="btn btn-star btn-large" onclick="pickRandomFlashcard()">🎲 اختر بطاقة عشوائية</button>
                </div>
                <div id="activeCardUI" style="display: none;">
                    <div class="trainee-card-display">
                        <div class="card-inner" id="flashcard">
                            <div class="card-front">
                                <span class="card-label">السؤال</span>
                                <p id="flashcardQ"></p>
                            </div>
                            <div class="card-back">
                                <span class="card-label">الإجابة</span>
                                <p id="flashcardA"></p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;
    }

    if (trainees.length > 0) {
        const currentStars = currentAxis ? (axisStars[currentAxis.id] || {}) : {};
        const starCount = currentSelectedTrainee ? (currentStars[currentSelectedTrainee.id] || 0) : 0;
        const questionType = currentQuestion.type;
        const selectedForThisType = selectedTraineesByType[questionType] || [];
        const remainingCount = trainees.length - selectedForThisType.length;

        html += `
            <div class="random-picker">
                <h3>🎲 اختيار متدرب عشوائي</h3>
                <div class="picker-info">
                    <span class="remaining-count">المتبقي: ${remainingCount} / ${trainees.length}</span>
                    <span class="question-type-label">${getQuestionTypeName(questionType)}</span>
                    ${selectedForThisType.length > 0 ? `<button class="btn btn-reset-small" onclick="resetSelectedTraineesByType()">🔄 إعادة تعيين</button>` : ''}
                </div>
                <div class="selected-trainee" id="selectedTrainee"></div>
                <div class="picker-buttons">
                    <button class="btn btn-primary btn-large" onclick="pickRandomTrainee()" ${remainingCount === 0 ? 'disabled' : ''}>${remainingCount === 0 ? '✅ تم اختيار الجميع' : 'اختر متدرباً'}</button>
                    ${currentSelectedTrainee ? `<button class="btn btn-star btn-large" onclick="grantStar()">⭐ منح نجمة</button>` : ''}
                </div>
                ${currentSelectedTrainee ? `<div class="trainee-stars">${'⭐'.repeat(starCount)}</div>` : ''}
                ${selectedForThisType.length > 0 ? `<div class="selected-list"><h4>المتدربين المختارين لهذا النوع:</h4><div class="trainee-tags">${selectedForThisType.map(id => { const t = trainees.find(tr => tr.id === id); return t ? `<span class="trainee-tag">✅ ${t.name}</span>` : ''; }).join('')}</div></div>` : ''}
            </div>
        `;
    }

    html += `
            <div class="control-buttons">
                ${(currentQuestion.type === 'truefalse' || currentQuestion.type === 'multiple' || currentQuestion.type === 'scenario') ?
            '<button class="btn btn-primary btn-large" onclick="revealAnswer()">🎯 كشف الإجابة</button>' :
            (currentQuestion.type === 'roleplay' ? '' :
                `<button class="btn btn-primary btn-large" onclick="showModelAnswer()">${currentQuestion.type === 'finderrors' ? '🚩 عرض قائمة الأخطاء' : (currentQuestion.type === 'traineecards' ? '🔄 قلب البطاقة' : '💡 عرض الإجابة النموذجية')}</button>`)}
                <div class="question-actions trainer-only">
                    <button class="btn btn-edit btn-large" onclick="editCurrentQuestion()">✏️ تعديل</button>
                    <button class="btn btn-danger btn-large" onclick="deleteCurrentQuestion()">🗑️ حذف</button>
                </div>
                <button class="btn btn-secondary btn-large" onclick="renderAxisView()">${isPresentationMode() ? '↩️ العودة لقائمة الأسئلة' : '↩️ رجوع'}</button>
            </div>
        </div>
    `;

    document.getElementById('mainContent').innerHTML = html;
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function selectOption(answer) {
    userAnswer = answer;
    const options = document.querySelectorAll('.option');
    options.forEach(opt => opt.classList.remove('selected'));

    if (currentQuestion.type === 'truefalse') {
        options[answer ? 0 : 1].classList.add('selected');
    } else if (currentQuestion.type === 'multiple' || currentQuestion.type === 'scenario') {
        options[answer].classList.add('selected');
    }
}

function revealAnswer() {
    if (userAnswer === null) {
        alert('الرجاء اختيار إجابة أولاً');
        return;
    }

    const isCorrect = userAnswer === currentQuestion.correctAnswer;
    const options = document.querySelectorAll('.option');

    if (currentQuestion.type === 'truefalse') {
        const selectedIndex = userAnswer ? 0 : 1;
        const correctIndex = currentQuestion.correctAnswer ? 0 : 1;

        if (isCorrect) {
            options[selectedIndex].classList.add('correct');
            showSuccess();
        } else {
            options[selectedIndex].classList.add('wrong');
            options[correctIndex].classList.add('correct');
            showError();
        }
    } else if (currentQuestion.type === 'multiple') {
        if (isCorrect) {
            options[userAnswer].classList.add('correct');
            showSuccess();
        } else {
            options[userAnswer].classList.add('wrong');
            options[currentQuestion.correctAnswer].classList.add('correct');
            showError();
        }
    } else if (currentQuestion.type === 'scenario') {
        if (isCorrect) {
            options[userAnswer].classList.add('correct');
            showSuccess();
        } else {
            options[userAnswer].classList.add('wrong');
            options[currentQuestion.correctAnswer].classList.add('correct');
            showError();
        }
        document.getElementById('justificationAnswer').style.display = 'block';
    }

    markQuestionAsCompleted();
}

function showModelAnswer() {
    if (currentQuestion.type === 'essay') {
        document.getElementById('essayAnswer').style.display = 'block';
    } else if (currentQuestion.type === 'casestudy') {
        document.getElementById('caseModelAnswer').style.display = 'block';
    } else if (currentQuestion.type === 'finderrors') {
        document.getElementById('errorsListDisplay').style.display = 'block';
    } else if (currentQuestion.type === 'traineecards') {
        document.getElementById('flashcard').classList.add('flipped');
    }
    markQuestionAsCompleted();
}

async function markQuestionAsCompleted() {
    if (!currentAxis || !currentQuestion) return;

    if (!completedQuestions[currentAxis.id]) {
        completedQuestions[currentAxis.id] = [];
    }

    if (!completedQuestions[currentAxis.id].includes(currentQuestion.id)) {
        completedQuestions[currentAxis.id].push(currentQuestion.id);
        await syncCurrentCourse();
    }
}

function showSuccess() {
    // Confetti
    for (let i = 0; i < 50; i++) {
        setTimeout(() => {
            const confetti = document.createElement('div');
            confetti.className = 'confetti';
            confetti.style.left = Math.random() * 100 + '%';
            confetti.style.background = ['#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#3b82f6'][Math.floor(Math.random() * 5)];
            confetti.style.animationDelay = Math.random() * 0.5 + 's';
            document.body.appendChild(confetti);

            setTimeout(() => confetti.remove(), 3000);
        }, i * 30);
    }

    // Emoji
    showEmoji('🎉', '50%', '50%');
    setTimeout(() => showEmoji('✨', '30%', '40%'), 200);
    setTimeout(() => showEmoji('🌟', '70%', '60%'), 400);
}

function showError() {
    showEmoji('😔', '50%', '50%');
    setTimeout(() => showEmoji('💭', '40%', '45%'), 200);
}

function showEmoji(emoji, left, top) {
    const emojiEl = document.createElement('div');
    emojiEl.className = 'emoji-feedback';
    emojiEl.textContent = emoji;
    emojiEl.style.left = left;
    emojiEl.style.top = top;
    document.body.appendChild(emojiEl);

    setTimeout(() => emojiEl.remove(), 2000);
}

// Trainees Management
function openTraineesModal() {
    document.getElementById('traineesModal').classList.add('active');
    document.getElementById('traineeNameInput').value = '';
}

async function addTrainee() {
    const name = document.getElementById('traineeNameInput').value.trim();
    if (!name) {
        alert('الرجاء إدخال اسم المتدرب');
        return;
    }

    trainees.push({ id: Date.now(), name: name });
    await syncCurrentCourse();
    document.getElementById('traineeNameInput').value = '';
    renderTraineesList();
}

async function deleteTrainee(id) {
    trainees = trainees.filter(t => t.id !== id);
    await syncCurrentCourse();
    renderTraineesList();
}

function renderTraineesList() {
    const container = document.getElementById('traineesList');
    if (trainees.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #94a3b8; padding: 20px;">لا يوجد متدربين</p>';
        return;
    }

    container.innerHTML = trainees.map(trainee => `
        <div class="trainee-item">
            <span>${trainee.name}</span>
            <button onclick="deleteTrainee(${trainee.id})">حذف</button>
        </div>
    `).join('');
}

function pickRandomTrainee() {
    if (trainees.length === 0) return;
    if (!currentQuestion) return;

    const selectedEl = document.getElementById('selectedTrainee');
    let counter = 0;
    const maxCount = 20;

    const questionType = currentQuestion.type;
    const selectedForThisType = selectedTraineesByType[questionType] || [];
    const availableTrainees = trainees.filter(t => !selectedForThisType.includes(t.id));

    if (availableTrainees.length === 0) {
        alert('✅ تم اختيار جميع المتدربين لهذا النوع!\n\nاضغط "إعادة تعيين" لإعادة المحاولة');
        return;
    }

    const interval = setInterval(() => {
        const randomIndex = Math.floor(Math.random() * availableTrainees.length);
        selectedEl.textContent = availableTrainees[randomIndex].name;
        counter++;

        if (counter >= maxCount) {
            clearInterval(interval);
            currentSelectedTrainee = availableTrainees[randomIndex];

            if (!selectedTraineesByType[questionType]) {
                selectedTraineesByType[questionType] = [];
            }
            selectedTraineesByType[questionType].push(currentSelectedTrainee.id);

            selectedEl.style.color = 'var(--primary)';
            selectedEl.style.textShadow = '0 0 20px rgba(14, 165, 233, 0.5)';
            updateTraineeDisplay();
            startQuestionTimer();
        }
    }, 100);
}

function updateTraineeDisplay() {
    if (!currentSelectedTrainee || !currentAxis) return;

    const currentStars = axisStars[currentAxis.id] || {};
    const starCount = currentStars[currentSelectedTrainee.id] || 0;

    const pickerContainer = document.querySelector('.random-picker');
    if (pickerContainer) {
        let starsEl = pickerContainer.querySelector('.trainee-stars');
        let btnStar = pickerContainer.querySelector('.btn-star');

        if (!starsEl) {
            starsEl = document.createElement('div');
            starsEl.className = 'trainee-stars';
            pickerContainer.appendChild(starsEl);
        }

        if (!btnStar) {
            btnStar = document.createElement('button');
            btnStar.className = 'btn btn-star btn-large';
            btnStar.textContent = '⭐ منح نجمة';
            btnStar.onclick = grantStar;

            const buttonsDiv = pickerContainer.querySelector('.picker-buttons');
            if (buttonsDiv) {
                buttonsDiv.appendChild(btnStar);
            }
        }

        starsEl.innerHTML = '⭐'.repeat(starCount);

        const remainingCountEl = pickerContainer.querySelector('.remaining-count');
        if (remainingCountEl && currentQuestion) {
            const questionType = currentQuestion.type;
            const selectedForThisType = selectedTraineesByType[questionType] || [];
            const remaining = trainees.length - selectedForThisType.length;
            remainingCountEl.textContent = `المتبقي: ${remaining} / ${trainees.length}`;
        }

        const pickBtn = pickerContainer.querySelector('.picker-buttons button:first-child');
        if (pickBtn && currentQuestion) {
            const questionType = currentQuestion.type;
            const selectedForThisType = selectedTraineesByType[questionType] || [];
            const remaining = trainees.length - selectedForThisType.length;
            if (remaining === 0) {
                pickBtn.textContent = '✅ تم اختيار الجميع';
                pickBtn.disabled = true;
            }
        }
    }
}

function resetSelectedTraineesByType() {
    if (!currentQuestion) return;

    const questionType = currentQuestion.type;

    if (!confirm(`هل أنت متأكد من إعادة تعيين قائمة المتدربين لنوع "${getQuestionTypeName(questionType)}"؟\nسيتم إتاحة جميع المتدربين للاختيار مرة أخرى.`)) {
        return;
    }

    delete selectedTraineesByType[questionType];
    currentSelectedTrainee = null;
    stopQuestionTimer();

    displayQuestion(currentAxis.questions.indexOf(currentQuestion));
}

async function grantStar() {
    if (!currentSelectedTrainee || !currentAxis) return;

    if (!axisStars[currentAxis.id]) {
        axisStars[currentAxis.id] = {};
    }

    axisStars[currentAxis.id][currentSelectedTrainee.id] = (axisStars[currentAxis.id][currentSelectedTrainee.id] || 0) + 1;
    await syncCurrentCourse();

    showEmoji('⭐', '50%', '40%');
    setTimeout(() => showEmoji('🌟', '50%', '30%'), 300);

    markQuestionAsCompleted();
    displayQuestion(currentAxis.questions.indexOf(currentQuestion));
}

function showLeaderboard() {
    if (!currentAxis || !axisStars[currentAxis.id]) {
        alert('لا توجد نجوم بعد!');
        return;
    }

    const stars = axisStars[currentAxis.id];
    const leaderboard = Object.entries(stars)
        .map(([traineeId, count]) => {
            const trainee = trainees.find(t => t.id == traineeId);
            return { trainee, count };
        })
        .filter(item => item.trainee)
        .sort((a, b) => b.count - a.count);

    if (leaderboard.length === 0) {
        alert('لا توجد نجوم بعد!');
        return;
    }

    const champion = leaderboard[0];
    let html = `
        <div class="leaderboard-modal">
            <h2>🏆 بطل المحور</h2>
            <div class="champion">
                <div class="champion-name">${champion.trainee.name}</div>
                <div class="champion-stars">${'⭐'.repeat(champion.count)}</div>
            </div>
            <h3>📊 ترتيب النجوم</h3>
            <div class="leaderboard-list">
    `;

    leaderboard.forEach((item, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        html += `
            <div class="leaderboard-item">
                <span class="medal">${medal}</span>
                <span class="name">${item.trainee.name}</span>
                <span class="stars">${'⭐'.repeat(item.count)}</span>
            </div>
        `;
    });

    html += `
            </div>
            <button class="btn btn-secondary btn-large" onclick="renderAxisView()">إغلاق</button>
        </div>
    `;

    document.getElementById('mainContent').innerHTML = html;
}

function showGlobalLeaderboard() {
    const globalStars = {};

    Object.entries(axisStars).forEach(([axisId, stars]) => {
        Object.entries(stars).forEach(([traineeId, count]) => {
            if (!globalStars[traineeId]) {
                globalStars[traineeId] = 0;
            }
            globalStars[traineeId] += count;
        });
    });

    const leaderboard = Object.entries(globalStars)
        .map(([traineeId, count]) => {
            const trainee = trainees.find(t => t.id == traineeId);
            return { trainee, count, axisStars: {} };
        })
        .filter(item => item.trainee);

    Object.entries(axisStars).forEach(([axisId, stars]) => {
        Object.entries(stars).forEach(([traineeId, count]) => {
            const item = leaderboard.find(l => l.trainee.id == traineeId);
            if (item) {
                const axis = axes.find(a => a.id == axisId);
                if (axis) {
                    item.axisStars[axis.title] = count;
                }
            }
        });
    });

    leaderboard.sort((a, b) => b.count - a.count);

    if (leaderboard.length === 0) {
        alert('لا توجد نجوم بعد!');
        return;
    }

    const champion = leaderboard[0];
    let html = `
        <div class="leaderboard-modal">
            <h2>🏆 بطل التدريب</h2>
            <div class="champion">
                <div class="champion-name">${champion.trainee.name}</div>
                <div class="champion-stars">${'⭐'.repeat(champion.count)}</div>
            </div>
            <h3>📊 الترتيب العام للنجوم</h3>
            <div class="leaderboard-list">
    `;

    leaderboard.forEach((item, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        const axisDetails = Object.entries(item.axisStars)
            .map(([axis, count]) => `${axis}: ${count}⭐`)
            .join(' | ');

        html += `
            <div class="leaderboard-item">
                <span class="medal">${medal}</span>
                <div class="leaderboard-details">
                    <span class="name">${item.trainee.name}</span>
                    <span class="axis-breakdown">${axisDetails}</span>
                </div>
                <span class="stars">${'⭐'.repeat(item.count)}</span>
            </div>
        `;
    });

    html += `
            </div>
            <button class="btn btn-secondary btn-large" onclick="showWelcomeScreen()">إغلاق</button>
        </div>
    `;

    document.getElementById('mainContent').innerHTML = html;
}

function showFinalReport() {
    const globalStars = {};
    let totalStars = 0;
    let totalQuestions = 0;
    let totalAxes = axes.length;

    Object.entries(axisStars).forEach(([axisId, stars]) => {
        Object.entries(stars).forEach(([traineeId, count]) => {
            if (!globalStars[traineeId]) {
                globalStars[traineeId] = 0;
            }
            globalStars[traineeId] += count;
            totalStars += count;
        });
    });

    axes.forEach(axis => {
        totalQuestions += axis.questions.length;
    });

    const leaderboard = Object.entries(globalStars)
        .map(([traineeId, count]) => {
            const trainee = trainees.find(t => t.id == traineeId);
            return { trainee, count, axisStars: {} };
        })
        .filter(item => item.trainee);

    Object.entries(axisStars).forEach(([axisId, stars]) => {
        Object.entries(stars).forEach(([traineeId, count]) => {
            const item = leaderboard.find(l => l.trainee.id == traineeId);
            if (item) {
                const axis = axes.find(a => a.id == axisId);
                if (axis) {
                    item.axisStars[axis.title] = count;
                }
            }
        });
    });

    leaderboard.sort((a, b) => b.count - a.count);

    const now = new Date();
    const dateStr = now.toLocaleDateString('ar-SA', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    let html = `
        <div class="final-report" id="finalReport">
            <div class="report-header">
                <div class="report-logo">🎓</div>
                <h1>📋 تقرير الختام</h1>
                <p class="report-date">${dateStr}</p>
            </div>
            
            <div class="report-stats">
                <div class="stat-item">
                    <div class="stat-value">${axes.length}</div>
                    <div class="stat-label">المحاور</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${totalQuestions}</div>
                    <div class="stat-label">الأسئلة</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${trainees.length}</div>
                    <div class="stat-label">المتدربين</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${totalStars}</div>
                    <div class="stat-label">النجوم</div>
                </div>
            </div>
            
            <div class="hall-of-fame">
                <h2>🏆 لوحة الشرف</h2>
                ${leaderboard.length > 0 ? `
                    <div class="top-three">
                        ${leaderboard[1] ? `
                            <div class="podium-item second">
                                <div class="trophy">🥈</div>
                                <div class="name">${leaderboard[1].trainee.name}</div>
                                <div class="stars">${'⭐'.repeat(leaderboard[1].count)}</div>
                            </div>
                        ` : ''}
                        ${leaderboard[0] ? `
                            <div class="podium-item first">
                                <div class="trophy">🥇</div>
                                <div class="name">${leaderboard[0].trainee.name}</div>
                                <div class="stars">${'⭐'.repeat(leaderboard[0].count)}</div>
                            </div>
                        ` : ''}
                        ${leaderboard[2] ? `
                            <div class="podium-item third">
                                <div class="trophy">🥉</div>
                                <div class="name">${leaderboard[2].trainee.name}</div>
                                <div class="stars">${'⭐'.repeat(leaderboard[2].count)}</div>
                            </div>
                        ` : ''}
                    </div>
                ` : '<p class="no-data">لا توجد نجوم بعد</p>'}
            </div>
            
            ${leaderboard.length > 3 ? `
                <div class="full-ranking">
                    <h3>📊 الترتيب الكامل</h3>
                    <table>
                        <thead>
                            <tr>
                                <th>الترتيب</th>
                                <th>المتدرب</th>
                                <th>النجوم</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${leaderboard.slice(3).map((item, index) => `
                                <tr>
                                    <td>${index + 4}</td>
                                    <td>${item.trainee.name}</td>
                                    <td>${'⭐'.repeat(item.count)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            ` : ''}
            
            <div class="report-footer">
                <p>تطبيق المدرب الاحترافي | Trainer App</p>
            </div>
            
            <div class="report-actions">
                <button class="btn btn-secondary btn-large" onclick="showWelcomeScreen()">إغلاق</button>
                <p class="screenshot-hint">📸 اصطحب شاشة (Screenshot) للمشاركة</p>
            </div>
        </div>
    `;

    document.getElementById('mainContent').innerHTML = html;
}

// Utilities
function getQuestionTypeName(type) {
    const types = {
        'truefalse': 'صح وخطأ',
        'multiple': 'اختيار من متعدد',
        'matching': 'صل بين العمودين',
        'essay': 'سؤال مقالي',
        'scenario': 'سيناريو',
        'casestudy': 'دراسة حالة',
        'roleplay': 'لعب أدوار',
        'finderrors': 'اكتشاف أخطاء',
        'traineecards': 'بطاقات المتدربين'
    };
    return types[type] || type;
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

function showWelcomeScreen() {
    currentAxis = null;
    document.getElementById('mainContent').innerHTML = `
        <div class="welcome-screen">
            <h2>مرحباً بك في تطبيق المدرب الاحترافي</h2>
            <p>اختر محوراً من القائمة الجانبية للبدء</p>
        </div>
    `;
}

async function resetCompletedQuestions() {
    if (!currentAxis) return;

    if (!confirm('هل أنت متأكد من إعادة تعيين الأسئلة المكتملة؟\nسيتم إتاحة جميع الأسئلة للاختيار مرة أخرى.')) {
        return;
    }

    delete completedQuestions[currentAxis.id];
    await syncCurrentCourse();
    renderAxisView();
}

function exportData() {
    const data = {
        version: '2.0',
        exportDate: new Date().toISOString(),
        courses: courses
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trainer-app-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    alert('✅ تم تصدير البيانات بنجاح!');
}

async function importData(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            const data = JSON.parse(e.target.result);

            if (!data.courses || !Array.isArray(data.courses)) {
                alert('❌ الملف غير صالح. يرجى التأكد من اختيار ملف تصدير النسخة 2.0');
                return;
            }

            if (confirm('هل تريد استبدال جميع البيانات الحالية؟ (سيتم فقدان الدورات الحالية)')) {
                courses = data.courses || [];

                await dbSet('trainingCourses', courses);

                currentCourse = null;
                showCourseSelection();

                alert('✅ تم استيراد البيانات بنجاح!');
            }
        } catch (err) {
            alert('❌ خطأ في قراءة الملف');
        }
    };
    reader.readAsText(file);
    input.value = '';
}

async function clearAllData() {
    if (!confirm('⚠️ هل أنت متأكد من مسح جميع البيانات؟\n\nسيتم حذف جميع الدورات والمحاور والمتدربين.\n\n⚠️ هذا الإجراء لا يمكن التراجع عنه!')) {
        return;
    }

    if (!confirm('تأكيد نهائي: سيتم مسح جميع البيانات نهائياً!')) {
        return;
    }

    await dbDelete('trainingCourses');
    sessionStorage.removeItem('currentCourseId');

    courses = [];
    currentCourse = null;
    axes = [];
    trainees = [];
    axisStars = {};
    completedQuestions = {};
    currentAxis = null;
    currentSelectedTrainee = null;
    stopQuestionTimer();

    showCourseSelection();

    alert('✅ تم مسح جميع البيانات بنجاح');
}

function toggleCinemaMode() {
    const elem = document.documentElement;

    if (!document.fullscreenElement) {
        elem.requestFullscreen().catch(err => {
            alert('لا يمكن تفعيل وضع ملء الشاشة');
        });
    } else {
        document.exitFullscreen();
    }
}

document.addEventListener('fullscreenchange', () => {
    const btn = document.querySelector('.cinema-mode-btn');
    if (btn) {
        btn.textContent = document.fullscreenElement ? '🔲' : '🎬';
    }
});

// Close modal on background click
document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('active');
        }
    });
});

// Session Timer Functions
function startQuestionTimer(seconds = DEFAULT_QUESTION_TIME) {
    stopQuestionTimer();
    questionTimeLeft = seconds;

    const timerHtml = `
        <div class="question-timer" id="questionTimer">
            <div class="timer-icon">⏱️</div>
            <div class="timer-display">
                <span class="timer-label">الوقت المتبقي</span>
                <span class="timer-value" id="timerValue">${formatTime(questionTimeLeft)}</span>
            </div>
            <div class="timer-controls ${isPresentationMode() ? 'trainer-only' : ''}">
                <button class="timer-btn" onclick="adjustTimer(30)" title="إضافة 30 ثانية">➕</button>
                <button class="timer-btn" onclick="adjustTimer(-30)" title="خصم 30 ثانية">➖</button>
                <button class="timer-btn timer-btn-reset" onclick="startQuestionTimer()" title="إعادة المؤقت">🔄</button>
            </div>
        </div>
    `;

    const timerContainer = document.getElementById('timerContainer');
    if (timerContainer) {
        timerContainer.innerHTML = timerHtml;
    }

    questionTimer = setInterval(() => {
        questionTimeLeft--;
        const timerValue = document.getElementById('timerValue');
        if (timerValue) {
            timerValue.textContent = formatTime(questionTimeLeft);
        }

        const timerEl = document.getElementById('questionTimer');
        if (timerEl) {
            if (questionTimeLeft <= 30) {
                timerEl.classList.add('warning');
            }
            if (questionTimeLeft <= 10) {
                timerEl.classList.add('danger');
            }
        }

        if (questionTimeLeft <= 0) {
            stopQuestionTimer();
            showTimeUpAlert();
        }
    }, 1000);
}

function stopQuestionTimer() {
    if (questionTimer) {
        clearInterval(questionTimer);
        questionTimer = null;
    }
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function adjustTimer(seconds) {
    questionTimeLeft = Math.max(0, questionTimeLeft + seconds);
    const timerValue = document.getElementById('timerValue');
    if (timerValue) {
        timerValue.textContent = formatTime(questionTimeLeft);
    }

    const timerEl = document.getElementById('questionTimer');
    if (timerEl) {
        timerEl.classList.remove('warning', 'danger');
        if (questionTimeLeft <= 30) {
            timerEl.classList.add('warning');
        }
        if (questionTimeLeft <= 10) {
            timerEl.classList.add('danger');
        }
    }
}

function showTimeUpAlert() {
    const alert = document.createElement('div');
    alert.className = 'timer-alert';
    alert.innerHTML = '⏰ انتهى الوقت!';
    document.body.appendChild(alert);
    setTimeout(() => alert.remove(), 3000);

    showEmoji('⏰', '50%', '40%');
    setTimeout(() => showEmoji('💭', '50%', '60%'), 500);
}

function distributeRoles() {
    if (trainees.length < currentQuestion.roles.length) {
        alert('عدد المتدربين أقل من عدد الأدوار المطلوبة!');
        return;
    }

    const shuffledTrainees = [...trainees].sort(() => Math.random() - 0.5);
    const roles = currentQuestion.roles;

    roles.forEach((role, index) => {
        const trainee = shuffledTrainees[index];
        const element = document.getElementById(`role-${role.replace(/\s+/g, '-')}`);
        if (element) {
            element.textContent = trainee.name;
            element.style.color = 'var(--primary)';
            element.style.fontWeight = '900';
            element.style.fontSize = '1.4rem';
            element.classList.add('animate-pop');
        }
    });

    showSuccess();
    markQuestionAsCompleted();
    startQuestionTimer();
}

function pickRandomFlashcard() {
    const cards = currentQuestion.cards;
    const randomIndex = Math.floor(Math.random() * cards.length);
    const selectedCard = cards[randomIndex];

    document.getElementById('flashcardQ').textContent = selectedCard.q;
    document.getElementById('flashcardA').textContent = selectedCard.a;

    document.getElementById('cardsPickerUI').style.display = 'none';
    document.getElementById('activeCardUI').style.display = 'block';

    showEmoji('🎲', '50%', '50%');
}

// Initialize app
init();
