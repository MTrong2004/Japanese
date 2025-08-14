// Khởi tạo các biến toàn cục
let vocabulary = []; // Mảng chứa từ vựng
let trashBin = []; // Mảng chứa thùng rác
let currentQuestion = null; // Câu hỏi hiện tại trong quiz
let currentOptions = []; // Đáp án hiện tại của quiz
let isRandomized = false; // Trạng thái random thứ tự câu hỏi
let isMeaningAlwaysVisible = false; // Trạng thái hiển thị nghĩa liên tục
let retryQueue = []; // Hàng đợi từ cần ôn lại
let questionsSinceLastRetry = 0; // Đếm số câu từ lần ôn lại cuối
let correctWords = new Set(); // Tập hợp các từ đã trả lời đúng
let filteredVocab = []; // Từ vựng đã lọc cho quiz
let isVocabularyLoaded = false; // Cờ theo dõi trạng thái load từ vựng
let currentEditingRow = null; // Theo dõi row đang được edit để tránh conflict
let isAutoContinue = false; // Trạng thái tự động tiếp tục khi trả lời đúng

// Lấy giá trị cài đặt từ localStorage hoặc đặt mặc định
let retryInterval = localStorage.getItem('retryInterval') ? parseInt(localStorage.getItem('retryInterval'), 10) : 10;
let retryMax = localStorage.getItem('retryMax') ? parseInt(localStorage.getItem('retryMax'), 10) : 3;

// Khôi phục cài đặt random từ localStorage
if (localStorage.getItem('isRandomized') !== null) {
    isRandomized = localStorage.getItem('isRandomized') === 'true';
}

// Khôi phục cài đặt auto-continue từ localStorage
if (localStorage.getItem('isAutoContinue') !== null) {
    isAutoContinue = localStorage.getItem('isAutoContinue') === 'true';
}

// Cập nhật cài đặt khi người dùng thay đổi
document.getElementById('retry-interval').addEventListener('change', (e) => {
    retryInterval = parseInt(e.target.value, 10);
    localStorage.setItem('retryInterval', retryInterval);
});

document.getElementById('retry-max').addEventListener('change', (e) => {
    retryMax = parseInt(e.target.value, 10);
    localStorage.setItem('retryMax', retryMax);
});

// Hàm cập nhật thanh tiến độ
function updateProgressBar() {
    if (!filteredVocab || filteredVocab.length === 0) {
        document.getElementById('progress').style.width = '0%';
        document.getElementById('progress-text').textContent = '0/0';
        return;
    }
    const totalVocab = filteredVocab.length;
    const correctInFiltered = filteredVocab.filter(word => correctWords.has(word.originalIndex)).length;
    const progressPercent = totalVocab > 0 ? (correctInFiltered / totalVocab) * 100 : 0;
    document.getElementById('progress').style.width = `${progressPercent}%`;
    document.getElementById('progress-text').textContent = `${correctInFiltered}/${totalVocab}`;
}

// Tải dữ liệu khi trang được load
window.addEventListener('load', () => {
    document.getElementById('start-quiz-btn').disabled = true;
    
    if (!localStorage.getItem('vocabulary')) {
        fetch('default.xlsx')
            .then(response => response.arrayBuffer())
            .then(data => {
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const jsonData = XLSX.utils.sheet_to_json(firstSheet);
                vocabulary = jsonData.map((row, index) => {
                    let romaji = row['Romaji'] || wanakana.toRomaji(row['Hiragana/Katakana']);
                    return {
                        kanji: row['Kanji'] || '',
                        hiragana: row['Hiragana/Katakana'],
                        romaji: romaji,
                        meaning: row['Nghĩa'],
                        lesson: row['Bài'].toString(),
                        originalIndex: index,
                        retryCount: 0
                    };
                });
                localStorage.setItem('vocabulary', JSON.stringify(vocabulary));
                
                // Đánh dấu vocabulary đã được load
                isVocabularyLoaded = true;
                
                // Auto-sort and display vocabulary
                refreshVocabularyTable();
                
                // Tạo lesson buttons cho quiz
                populateLessonButtons();
                
                updateSelectedVocabCount();
                
                // Cập nhật trạng thái nút start quiz sau khi load xong
                updateStartQuizButton();
            });
    } else {
        vocabulary = JSON.parse(localStorage.getItem('vocabulary'));
        vocabulary.forEach(word => {
            if (!word.romaji) word.romaji = wanakana.toRomaji(word.hiragana);
            word.retryCount = word.retryCount || 0;
            word.lesson = word.lesson.toString();
        });
        
        // Đánh dấu vocabulary đã được load
        isVocabularyLoaded = true;
        
        // Auto-sort and display vocabulary
        refreshVocabularyTable();
        
        // Tạo lesson buttons cho quiz
        populateLessonButtons();
        
        updateSelectedVocabCount();
        
        // Cập nhật trạng thái nút start quiz sau khi load xong
        updateStartQuizButton();
    }

    if (localStorage.getItem('trashBin')) {
        trashBin = JSON.parse(localStorage.getItem('trashBin'));
        trashBin.forEach(word => addToTable(word, 'trash'));
    }

    document.getElementById('start-quiz-btn').addEventListener('click', () => {
        startQuiz();
    });

    // Đảm bảo XLSX library đã load trước khi đăng ký event listeners
    if (typeof XLSX !== 'undefined') {
        setupExcelHandlers();
    } else {
        // Đợi một chút cho XLSX library load
        setTimeout(() => {
            if (typeof XLSX !== 'undefined') {
                setupExcelHandlers();
            } else {
                console.error('XLSX library failed to load');
            }
        }, 1000);
    }
});

// Hàm bắt đầu quiz (di chuyển ra ngoài để có thể gọi từ mọi nơi)
function startQuiz() {
    console.log('startQuiz() called');
    const selectedCards = document.querySelectorAll('.lesson-card.selected');
    console.log('Selected cards found:', selectedCards.length);
    
    const selectedLessons = Array.from(selectedCards).map(card => card.dataset.lesson);
    console.log('Selected lessons:', selectedLessons);
    
    if (selectedLessons.length === 0) {
        console.log('No lessons selected');
        alert('Vui lòng chọn ít nhất một bài học.');
        return;
    }
    filteredVocab = vocabulary.filter(word => selectedLessons.includes(word.lesson.toString()));
    console.log('Filtered vocab count:', filteredVocab.length);
    
    if (filteredVocab.length < 4) {
        console.log('Not enough vocab words');
        alert('Không đủ từ vựng (ít nhất 4 từ) để bắt đầu quiz.');
        return;
    }
    
    console.log('Starting quiz with', filteredVocab.length, 'words');
    correctWords = new Set();
    retryQueue = [];
    currentOptions = [];
    
    // Hiển thị thông tin bài học đang luyện tập
    displayQuizLessonInfo(selectedLessons);
    
    document.getElementById('lesson-selection').classList.add('hidden');
    document.querySelector('.quiz-card').classList.remove('hidden');
    updateProgressBar();
    loadQuiz();
}

// Hàm hiển thị thông tin bài học đang luyện tập
function displayQuizLessonInfo(selectedLessons) {
    const quizLessonInfo = document.getElementById('quiz-lesson-info');
    
    // Tạo các thẻ thông tin bài học
    const lessonTags = selectedLessons.map(lesson => {
        const lessonLabel = isNaN(lesson) ? lesson : `Bài ${lesson}`;
        const wordsInLesson = vocabulary.filter(word => word.lesson.toString() === lesson.toString());
        const wordCount = wordsInLesson.length;
        
        return `<div class="lesson-info-tag" title="${wordCount} từ vựng">${lessonLabel}</div>`;
    }).join('');
    
    // Thêm thông tin tổng quan
    const totalWords = selectedLessons.reduce((total, lesson) => {
        return total + vocabulary.filter(word => word.lesson.toString() === lesson.toString()).length;
    }, 0);
    
    const summaryTag = `<div class="lesson-info-tag" style="background: linear-gradient(135deg, #28a745, #20c997);" title="Tổng số từ vựng">📊 ${totalWords} từ</div>`;
    
    quizLessonInfo.innerHTML = lessonTags + summaryTag;
}

    document.getElementById('retry-interval').value = retryInterval;
    document.getElementById('retry-max').value = retryMax;
    updateProgressBar();

    // Bật dark mode và auto-continue mặc định nếu chưa có cài đặt
    if (localStorage.getItem('darkMode') === null) {
        localStorage.setItem('darkMode', 'enabled');
    }
    
    if (localStorage.getItem('isAutoContinue') === null) {
        localStorage.setItem('isAutoContinue', 'true');
        isAutoContinue = true;
    }

    if (localStorage.getItem('darkMode') === 'enabled') {
        document.body.classList.add('dark-mode');
        document.getElementById('dark-mode-toggle').checked = true;
        document.querySelector('.icon-sun').classList.add('hidden');
        document.querySelector('.icon-moon').classList.remove('hidden');
    } else {
        document.querySelector('.icon-sun').classList.remove('hidden');
        document.querySelector('.icon-moon').classList.add('hidden');
    }
// Điền danh sách bài học vào nút
function populateLessonButtons() {
    const lessons = [...new Set(vocabulary.map(word => word.lesson))].sort((a, b) => a - b);
    const lessonButtonsContainer = document.getElementById('lesson-buttons');
    
    // Lưu trạng thái selected trước khi rebuild
    const selectedLessons = Array.from(document.querySelectorAll('.lesson-card.selected'))
        .map(card => card.dataset.lesson);
    
    lessonButtonsContainer.innerHTML = '';
    
    // Danh sách icon cho các bài học
    const lessonIcons = ['🌸', '🎋', '🏯', '🗾', '🎌', '🍜', '🍣', '🍱', '🎭', '⛩️', '🎑', '🌊', '🗻', '🎪', '🎯', '🎨', '🎵', '📚', '✨', '🎊'];
    
    lessons.forEach((lesson, index) => {
        const lessonCard = document.createElement('div');
        lessonCard.className = 'lesson-card';
        lessonCard.dataset.lesson = lesson;
        
        // Khôi phục trạng thái selected
        if (selectedLessons.includes(lesson.toString())) {
            lessonCard.classList.add('selected');
        }
        
        const lessonLabel = isNaN(lesson) ? lesson : `Bài ${lesson}`;
        const wordsInLesson = vocabulary.filter(word => word.lesson.toString() === lesson.toString());
        const wordCount = wordsInLesson.length;
        
        // Xác định độ khó dựa trên bài học cụ thể
        function getDifficultyByLesson(lessonNum) {
            const lessonNumber = parseInt(lessonNum);
            
            // Bài 1-5: Cơ bản (chào hỏi, gia đình, số đếm, thức ăn cơ bản)
            if (lessonNumber >= 1 && lessonNumber <= 5) {
                return { difficulty: 'beginner', text: 'Cơ bản' };
            }
            // Bài 6-12: Trung bình (thời gian, màu sắc, giao thông, trường học, cơ thể, sức khỏe, mua sắm)
            else if (lessonNumber >= 6 && lessonNumber <= 12) {
                return { difficulty: 'intermediate', text: 'Trung bình' };
            }
            // Bài 13-20: Nâng cao (công việc, nhà hàng, du lịch, thể thao, thiên nhiên, công nghệ, văn hóa, lễ hội)
            else if (lessonNumber >= 13 && lessonNumber <= 20) {
                return { difficulty: 'advanced', text: 'Nâng cao' };
            }
            // Bài > 20: Nâng cao
            else if (lessonNumber > 20) {
                return { difficulty: 'advanced', text: 'Nâng cao' };
            }
            // Fallback: dựa trên số từ vựng
            else {
                if (wordCount <= 15) {
                    return { difficulty: 'beginner', text: 'Cơ bản' };
                } else if (wordCount <= 30) {
                    return { difficulty: 'intermediate', text: 'Trung bình' };
                } else {
                    return { difficulty: 'advanced', text: 'Nâng cao' };
                }
            }
        }
        
        const difficultyInfo = getDifficultyByLesson(lesson);
        const difficulty = difficultyInfo.difficulty;
        const difficultyText = difficultyInfo.text;
        
        // Lấy icon cho bài học (lặp lại nếu hết icon)
        const icon = lessonIcons[index % lessonIcons.length];
        
        lessonCard.innerHTML = `
            <div class="lesson-card-icon">${icon}</div>
            <div class="lesson-card-content">
                <div class="lesson-card-title">${lessonLabel}</div>
                <div class="lesson-card-count">${wordCount} từ vựng</div>
                <div class="lesson-card-difficulty difficulty-${difficulty}">${difficultyText}</div>
            </div>
        `;
        
        lessonCard.addEventListener('click', () => {
            lessonCard.classList.toggle('selected');
            updateStartQuizButton();
            updateSelectedVocabCount();
        });

        lessonButtonsContainer.appendChild(lessonCard);
    });
}

// Cập nhật trạng thái nút "Bắt đầu Quiz"
function updateStartQuizButton() {
    // Kiểm tra xem vocabulary đã được load chưa
    if (!isVocabularyLoaded || vocabulary.length === 0) {
        const startQuizBtn = document.getElementById('start-quiz-btn');
        const errorMessage = document.getElementById('error-message');
        startQuizBtn.disabled = true;
        errorMessage.classList.add('hidden');
        return;
    }
    
    const selectedCards = document.querySelectorAll('.lesson-card.selected');
    const selectedLessons = Array.from(selectedCards).map(card => card.dataset.lesson);
    const filteredVocabTemp = vocabulary.filter(word => selectedLessons.includes(word.lesson.toString()));
    const startQuizBtn = document.getElementById('start-quiz-btn');
    const errorMessage = document.getElementById('error-message');
    if (filteredVocabTemp.length < 4) {
        errorMessage.classList.remove('hidden');
        startQuizBtn.disabled = true;
    } else {
        errorMessage.classList.add('hidden');
        startQuizBtn.disabled = false;
    }
}

// Quản lý giao diện các section
const sections = {
    home: document.getElementById('dashboard'),
    quiz: document.getElementById('quiz-section'),
    vocab: document.getElementById('vocab-section'),
    settings: document.getElementById('settings-section'),
    trash: document.getElementById('trash-section')
};

function hideAllSections() {
    Object.values(sections).forEach(section => {
        if (section) {
            section.classList.add('hidden');
        }
    });
}

function showSection(sectionId) {
    // Ẩn tất cả các section trước
    hideAllSections();
    
    // Xóa active state từ tất cả nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // Thêm active state cho nav item được chọn
    const activeNavMap = {
        'home': 'nav-home',
        'quiz': 'nav-quiz', 
        'vocab': 'nav-vocab',
        'settings': 'nav-settings'
    };
    
    if (activeNavMap[sectionId]) {
        document.getElementById(activeNavMap[sectionId]).classList.add('active');
    }
    
    // Hiển thị/ẩn floating button dựa trên section
    const floatingBtn = document.getElementById('floating-add-btn');
    if (floatingBtn) {
        if (sectionId === 'vocab') {
            floatingBtn.style.display = 'flex';
        } else {
            floatingBtn.style.display = 'none';
        }
    }
    
    // Hiển thị section được chọn
    if (sections[sectionId]) {
        sections[sectionId].classList.remove('hidden');
        console.log(`Showing section: ${sectionId}`); // Debug log
    }
    
    // Kiểm tra nếu section là "quiz"
    if (sectionId === 'quiz') {
        // Thử khôi phục trạng thái quiz
        const quizRestored = restoreQuizState();
        
        if (quizRestored) {
            // Nếu khôi phục thành công, hiển thị quiz card
            document.getElementById('lesson-selection').classList.add('hidden');
            document.querySelector('.quiz-card').classList.remove('hidden');
            console.log('Quiz restored successfully'); // Debug log
        } else {
            // Nếu không có trạng thái hoặc khôi phục thất bại, hiển thị phần chọn bài học
            document.getElementById('lesson-selection').classList.remove('hidden');
            document.querySelector('.quiz-card').classList.add('hidden');
            console.log('No quiz to restore, showing lesson selection'); // Debug log
            
            // Đảm bảo lesson cards được tạo
            populateLessonButtons();
        }
    }
}

document.getElementById('nav-home').addEventListener('click', () => showSection('home'));
document.getElementById('nav-quiz').addEventListener('click', () => showSection('quiz'));
document.getElementById('nav-vocab').addEventListener('click', () => showSection('vocab'));
document.getElementById('nav-settings').addEventListener('click', () => showSection('settings'));
showSection('home');

// Xử lý Dark Mode
document.getElementById('dark-mode-toggle').addEventListener('change', (e) => {
    if (e.target.checked) {
        document.body.classList.add('dark-mode');
        localStorage.setItem('darkMode', 'enabled');
        document.querySelector('.icon-sun').classList.add('hidden');
        document.querySelector('.icon-moon').classList.remove('hidden');
    } else {
        document.body.classList.remove('dark-mode');
        localStorage.setItem('darkMode', 'disabled');
        document.querySelector('.icon-sun').classList.remove('hidden');
        document.querySelector('.icon-moon').classList.add('hidden');
    }
});

// Cập nhật tổng số từ vựng
function updateTotalVocab() {
    const total = vocabulary.length;
    document.getElementById('total-vocab').textContent = total;
    
    // Cập nhật cả trong dashboard info cũ nếu có
    const totalVocabCount = document.getElementById('total-vocab-count');
    if (totalVocabCount) {
        totalVocabCount.textContent = `Tổng số từ vựng: ${total}`;
    }
}

// Tạo preview bài học cho trang chủ
function createLessonPreview() {
    const lessons = [...new Set(vocabulary.map(word => word.lesson))].sort((a, b) => a - b);
    const previewGrid = document.getElementById('lesson-preview-grid');
    
    if (!previewGrid) return;
    
    previewGrid.innerHTML = '';
    
    // Chỉ hiển thị 6 bài học đầu tiên
    const previewLessons = lessons.slice(0, 6);
    const lessonIcons = ['🌸', '🎋', '🏯', '🗾', '🎌', '🍜'];
    
    previewLessons.forEach((lesson, index) => {
        const lessonLabel = isNaN(lesson) ? lesson : `Bài ${lesson}`;
        const wordsInLesson = vocabulary.filter(word => word.lesson.toString() === lesson.toString());
        const wordCount = wordsInLesson.length;
        const icon = lessonIcons[index] || '📚';
        
        const previewCard = document.createElement('div');
        previewCard.className = 'lesson-preview-card';
        previewCard.innerHTML = `
            <div class="lesson-preview-icon">${icon}</div>
            <div class="lesson-preview-title">${lessonLabel}</div>
            <div class="lesson-preview-count">${wordCount} từ vựng</div>
        `;
        
        previewCard.addEventListener('click', () => {
            console.log('Preview card clicked for lesson:', lesson);
            console.log('Vocabulary loaded:', isVocabularyLoaded);
            console.log('Vocabulary length:', vocabulary.length);
            
            // Đảm bảo vocabulary đã được load
            if (!isVocabularyLoaded || vocabulary.length === 0) {
                alert('Dữ liệu từ vựng chưa được tải. Vui lòng đợi một chút.');
                return;
            }
            
            // Chuyển sang section quiz
            showSection('quiz');
            
            // Đợi một chút để đảm bảo lesson cards đã được tạo
            setTimeout(() => {
                console.log('Looking for lesson cards...');
                // Tự động chọn bài học này
                const lessonButtons = document.querySelectorAll('.lesson-card');
                console.log('Found lesson cards:', lessonButtons.length);
                
                lessonButtons.forEach(btn => {
                    btn.classList.remove('selected');
                    if (btn.dataset.lesson === lesson.toString()) {
                        btn.classList.add('selected');
                        console.log('Selected lesson card for lesson:', lesson);
                    }
                });
                
                // Cập nhật số từ vựng đã chọn
                updateSelectedVocabCount();
                
                // Tự động bắt đầu quiz nếu có đủ từ vựng
                console.log('Word count for lesson:', wordCount);
                if (wordCount >= 4) {
                    console.log('Starting quiz automatically...');
                    setTimeout(() => {
                        startQuiz();
                    }, 50);
                } else {
                    console.log('Not enough words to start quiz');
                }
            }, 100);
        });
        
        previewGrid.appendChild(previewCard);
    });
}

// ========================================
// VOCABULARY SORTING FUNCTIONALITY
// ========================================

// Function to sort vocabulary by original Excel order
function sortVocabularyByOriginalOrder() {
    vocabulary.sort((a, b) => {
        // Sắp xếp theo originalIndex (thứ tự ban đầu trong file Excel)
        return a.originalIndex - b.originalIndex;
    });
    
    // Save sorted vocabulary to localStorage
    localStorage.setItem('vocabulary', JSON.stringify(vocabulary));
}

// Function to sort vocabulary by lesson number
function sortVocabularyByLesson() {
    vocabulary.sort((a, b) => {
        // Convert lesson to number for proper sorting
        const lessonA = parseInt(a.lesson) || 999; // Put non-numeric lessons at end
        const lessonB = parseInt(b.lesson) || 999;
        
        if (lessonA !== lessonB) {
            return lessonA - lessonB;
        }
        
        // If same lesson, sort by kanji alphabetically
        return a.kanji.localeCompare(b.kanji);
    });
    
    // Save sorted vocabulary to localStorage
    localStorage.setItem('vocabulary', JSON.stringify(vocabulary));
}

// Function to refresh vocabulary table with sorted data
function refreshVocabularyTable() {
    // Reset editing state khi refresh table
    currentEditingRow = null;
    
    // Sort vocabulary by original Excel order
    sortVocabularyByOriginalOrder();
    
    // Clear table
    wordTableBody.innerHTML = '';
    
    // Re-populate table with sorted data
    vocabulary.forEach((word, index) => addToTable(word, 'word', index + 1));
    
    // Update related UI elements
    updateTotalVocab();
    createLessonPreview();
    populateLessonButtons();
    populateLessonDropdown();
    filterVocabularyTable();
    updateVocabCount();
}

// Function to refresh vocabulary table without sorting (for adding new words)
function refreshVocabularyTableWithoutSort() {
    // Reset editing state khi refresh table
    currentEditingRow = null;
    
    // Clear table
    wordTableBody.innerHTML = '';
    
    // Re-populate table with current order
    vocabulary.forEach((word, index) => addToTable(word, 'word', index + 1));
    
    // Update related UI elements
    updateTotalVocab();
    createLessonPreview();
    populateLessonButtons();
    populateLessonDropdown();
    filterVocabularyTable();
    updateVocabCount();
}

// Quản lý từ vựng
const addVocabForm = document.getElementById('add-vocab-form');
const wordTableBody = document.querySelector('#wordTable tbody');
const trashTableBody = document.querySelector('#trashTable tbody');

function addVocabulary(word) {
    if (!word.romaji) word.romaji = wanakana.toRomaji(word.hiragana);
    if (vocabulary.some(v => v.kanji === word.kanji && v.hiragana === word.hiragana)) {
        alert('Từ vựng đã tồn tại!');
        return false;
    }
    
    // Tìm vị trí phù hợp để chèn từ vựng mới dựa trên bài học
    const newLessonNum = parseInt(word.lesson) || 999;
    let insertIndex = vocabulary.length; // Mặc định thêm vào cuối
    
    // Tìm vị trí cuối cùng của bài học cùng loại hoặc bài học nhỏ hơn
    for (let i = vocabulary.length - 1; i >= 0; i--) {
        const currentLessonNum = parseInt(vocabulary[i].lesson) || 999;
        if (currentLessonNum <= newLessonNum) {
            insertIndex = i + 1;
            break;
        }
        if (i === 0) {
            insertIndex = 0;
        }
    }
    
    // Thiết lập originalIndex tạm thời
    word.originalIndex = 0; // Sẽ được cập nhật lại sau
    word.retryCount = word.retryCount || 0;
    
    // Chèn từ vựng vào vị trí phù hợp
    vocabulary.splice(insertIndex, 0, word);
    
    // Cập nhật lại tất cả originalIndex để đảm bảo thứ tự đúng
    vocabulary.forEach((word, index) => {
        word.originalIndex = index;
    });
    
    // Lưu vào localStorage
    localStorage.setItem('vocabulary', JSON.stringify(vocabulary));
    
    // Refresh table để hiển thị
    refreshVocabularyTableWithoutSort();
    return true;
}

function addToTable(word, tableType, index) {
    const tableBody = tableType === 'word' ? wordTableBody : trashTableBody;
    const newRow = document.createElement('tr');
    const kanjiDisplay = word.kanji || 'N/A';
    
    if (tableType === 'word') {
        newRow.dataset.index = index - 1; // Lưu index để xử lý
        
        newRow.innerHTML = `
            <td>${index}</td>
            <td class="editable-cell" data-field="kanji">${kanjiDisplay}</td>
            <td class="editable-cell" data-field="hiragana">${word.hiragana}</td>
            <td class="editable-cell" data-field="romaji">${word.romaji}</td>
            <td class="editable-cell" data-field="meaning">${word.meaning}</td>
            <td class="editable-cell" data-field="lesson">${word.lesson}</td>
            <td><button class="table-btn" onclick="playAudio('${word.hiragana}')"><i class="fas fa-volume-up"></i></button></td>
            <td class="table-actions">
                <button class="table-btn edit-btn" data-action="edit"><i class="fas fa-edit"></i> <span>Sửa</span></button>
                <button class="table-btn delete-btn" data-action="delete"><i class="fas fa-trash"></i> <span>Xóa</span></button>
            </td>
        `;
        
        // Thêm event listeners cho inline editing
        setupInlineEditing(newRow, word, index - 1);
        
    } else {
        newRow.innerHTML = `
            <td>${kanjiDisplay}</td>
            <td>${word.hiragana}</td>
            <td>${word.romaji}</td>
            <td>${word.meaning}</td>
            <td>${word.lesson}</td>
            <td class="table-actions">
                <button class="table-btn restore-btn"><i class="fas fa-undo"></i> Khôi phục</button>
            </td>
        `;
    }
    tableBody.appendChild(newRow);
}

// Hàm di chuyển từ vựng bằng drag & drop - REMOVED
// function moveVocabularyByDrop() - REMOVED

// Hàm thiết lập inline editing cho một row
function setupInlineEditing(row, wordData, wordIndex) {
    const editableCells = row.querySelectorAll('.editable-cell');
    const editBtn = row.querySelector('.edit-btn');
    const deleteBtn = row.querySelector('.delete-btn');
    
    // Kiểm tra xem event listener đã được thêm chưa để tránh duplicate
    if (editBtn.hasAttribute('data-listeners-added')) {
        return;
    }
    
    // Đánh dấu rằng listeners đã được thêm
    editBtn.setAttribute('data-listeners-added', 'true');
    deleteBtn.setAttribute('data-listeners-added', 'true');
    
    let isEditing = false;
    let originalValues = {};
    
    // Lưu giá trị gốc
    editableCells.forEach(cell => {
        originalValues[cell.dataset.field] = cell.textContent;
    });
    
    // Nút Edit
    editBtn.addEventListener('click', () => {
        if (isEditing) {
            saveChanges();
        } else {
            startEditing();
        }
    });
    
    // Nút Delete
    deleteBtn.addEventListener('click', () => {
        if (confirm('Bạn có chắc chắn muốn xóa từ vựng này?')) {
            deleteWord(wordIndex);
        }
    });
    
    function startEditing() {
        if (isEditing) return;
        
        // Kiểm tra xem có row nào khác đang được edit không
        if (currentEditingRow && currentEditingRow !== row) {
            alert('Vui lòng hoàn thành việc chỉnh sửa dòng hiện tại trước khi chỉnh sửa dòng khác!');
            return;
        }
        
        currentEditingRow = row;
        isEditing = true;
        
        // Mở rộng ô hành động để chứa 2 nút
        const actionsCell = row.querySelector('.col-actions');
        if (actionsCell) {
            actionsCell.classList.add('editing-mode');
        }
        
        editBtn.innerHTML = '<i class="fas fa-save"></i> <span>Lưu</span>';
        editBtn.classList.add('save-btn');
        
        // Thêm nút Cancel
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'table-btn cancel-btn';
        cancelBtn.innerHTML = '<i class="fas fa-times"></i> <span>Hủy</span>';
        editBtn.parentNode.insertBefore(cancelBtn, editBtn.nextSibling);
        
        cancelBtn.addEventListener('click', cancelEditing);
        
        editableCells.forEach(cell => {
            const currentValue = cell.textContent === 'N/A' ? '' : cell.textContent;
            cell.classList.add('editing');
            cell.innerHTML = `<input type="text" class="editable-input" value="${currentValue}" data-field="${cell.dataset.field}">`;
        });
        
        // Focus vào input đầu tiên
        const firstInput = row.querySelector('.editable-input');
        if (firstInput) firstInput.focus();
        
        // Enter để lưu, Escape để hủy
        row.addEventListener('keydown', handleKeyPress);
    }
    
    function saveChanges() {
        const inputs = row.querySelectorAll('.editable-input');
        const newData = {};
        
        inputs.forEach(input => {
            newData[input.dataset.field] = input.value.trim();
        });
        
        // Validate
        if (!newData.hiragana || !newData.meaning || !newData.lesson) {
            alert('Hiragana, Nghĩa và Bài là các trường bắt buộc!');
            return;
        }
        
        // Cập nhật dữ liệu
        vocabulary[wordIndex] = {
            ...vocabulary[wordIndex],
            kanji: newData.kanji || '',
            hiragana: newData.hiragana,
            romaji: newData.romaji || wanakana.toRomaji(newData.hiragana),
            meaning: newData.meaning,
            lesson: newData.lesson
        };
        
        // Lưu vào localStorage
        localStorage.setItem('vocabulary', JSON.stringify(vocabulary));
        
        // Cập nhật UI
        editableCells.forEach(cell => {
            const field = cell.dataset.field;
            const value = field === 'kanji' && !newData[field] ? 'N/A' : newData[field];
            cell.textContent = value;
            cell.classList.remove('editing');
        });
        
        finishEditing();
        
        // Chỉ refresh nếu lesson thay đổi để cập nhật số thứ tự
        if (originalValues.lesson !== newData.lesson) {
            refreshVocabularyTable();
        } else {
            // Chỉ cập nhật các element liên quan mà không refresh toàn bộ table
            updateTotalVocab();
            createLessonPreview();
            populateLessonButtons();
            populateLessonDropdown();
            updateVocabCount();
        }
    }
    
    function cancelEditing() {
        editableCells.forEach(cell => {
            cell.textContent = originalValues[cell.dataset.field];
            cell.classList.remove('editing');
        });
        finishEditing();
    }
    
    function finishEditing() {
        isEditing = false;
        currentEditingRow = null; // Reset global editing state
        
        // Thu hẹp ô hành động về kích thước bình thường
        const actionsCell = row.querySelector('.col-actions');
        if (actionsCell) {
            actionsCell.classList.remove('editing-mode');
        }
        
        editBtn.innerHTML = '<i class="fas fa-edit"></i> <span>Sửa</span>';
        editBtn.classList.remove('save-btn');
        
        const cancelBtn = row.querySelector('.cancel-btn');
        if (cancelBtn) cancelBtn.remove();
        
        row.removeEventListener('keydown', handleKeyPress);
    }
    
    function handleKeyPress(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveChanges();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelEditing();
        }
    }
}

// Hàm xóa từ vựng
function deleteWord(index) {
    const wordToDelete = vocabulary[index];
    
    // Chuyển vào thùng rác
    trashBin.push(wordToDelete);
    
    // Xóa khỏi vocabulary
    vocabulary.splice(index, 1);
    
    // Lưu vào localStorage
    localStorage.setItem('vocabulary', JSON.stringify(vocabulary));
    localStorage.setItem('trashBin', JSON.stringify(trashBin));
    
    // Refresh table
    refreshVocabularyTable();
    
    // Hiển thị thông báo
    showNotification('Đã chuyển từ vựng vào thùng rác', 'success');
}

// Hàm hiển thị thông báo
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 20px;
        border-radius: var(--radius-md);
        color: white;
        font-weight: 500;
        z-index: 9999;
        box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        transform: translateX(100%);
        transition: transform 0.3s ease;
    `;
    
    // Màu sắc theo type
    switch(type) {
        case 'success':
            notification.style.background = '#28a745';
            break;
        case 'error':
            notification.style.background = '#dc3545';
            break;
        case 'warning':
            notification.style.background = '#ffc107';
            notification.style.color = '#000';
            break;
        default:
            notification.style.background = '#17a2b8';
    }
    
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 100);
    
    // Auto remove
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 3000);
}

// Auto-generate Romaji khi nhập Hiragana
document.getElementById('hiragana').addEventListener('input', (e) => {
    const hiraganaValue = e.target.value.trim();
    const romajiInput = document.getElementById('romaji');
    
    if (hiraganaValue && !romajiInput.value) {
        romajiInput.value = wanakana.toRomaji(hiraganaValue);
    }
});

// Clear romaji khi xóa hiragana
document.getElementById('hiragana').addEventListener('blur', (e) => {
    const hiraganaValue = e.target.value.trim();
    const romajiInput = document.getElementById('romaji');
    
    if (!hiraganaValue) {
        romajiInput.value = '';
    }
});

// Floating Add Button Functionality
document.addEventListener('DOMContentLoaded', () => {
    const floatingBtn = document.getElementById('floating-add-btn');
    const addVocabCard = document.getElementById('add-vocab-card');
    const addVocabForm = document.getElementById('add-vocab-form');
    const closeBtn = document.getElementById('close-add-form');
    
    console.log('Floating button found:', floatingBtn);
    console.log('Add vocab card found:', addVocabCard);
    console.log('Add vocab form found:', addVocabForm);
    
    // Setup help modal
    setupHelpModal();

    // Mở form thêm từ vựng
    function openAddForm() {
        console.log('Opening form...');
        const backdrop = document.getElementById('add-vocab-backdrop');
        const formTitle = document.getElementById('form-title');
        const submitBtn = document.getElementById('submit-btn');
        
        addVocabCard.classList.remove('hidden');
        if (backdrop) backdrop.classList.add('show');
        floatingBtn.innerHTML = '<i class="fas fa-times"></i>'; // Đổi icon thành X
        
        // Set text for add mode
        if (formTitle) {
            formTitle.innerHTML = '<i class="fas fa-plus-circle"></i> Thêm từ vựng mới';
        }
        if (submitBtn) {
            submitBtn.innerHTML = '<i class="fas fa-plus"></i> Thêm từ vựng';
        }
        
        // Focus vào input đầu tiên
        const firstInput = addVocabCard.querySelector('input');
        if (firstInput) {
            setTimeout(() => firstInput.focus(), 100);
        }
    }

    // Đóng form thêm từ vựng
    function closeAddForm() {
        console.log('closeAddForm() called - Stack trace:');
        console.trace(); // Log stack trace để xem ai gọi function này
        const backdrop = document.getElementById('add-vocab-backdrop');
        const formTitle = document.getElementById('form-title');
        const submitBtn = document.getElementById('submit-btn');
        
        addVocabCard.classList.add('hidden');
        if (backdrop) backdrop.classList.remove('show');
        floatingBtn.innerHTML = '<i class="fas fa-plus"></i>'; // Đổi icon về dấu +
        
        // Reset text to add mode
        if (formTitle) {
            formTitle.innerHTML = '<i class="fas fa-plus-circle"></i> Thêm từ vựng mới';
        }
        if (submitBtn) {
            submitBtn.innerHTML = '<i class="fas fa-plus"></i> Thêm từ vựng';
        }
        
        // Reset form
        if (addVocabForm) addVocabForm.reset();
        
        // Reset edit mode
        isEditMode = false;
        editingIndex = -1;
        editingRow = null;
    }

    // Event listeners
    if (floatingBtn && addVocabCard && addVocabForm) {
        // KHÔNG theo dõi hover events nữa - đây có thể là nguyên nhân gây lỗi
        
        // Thêm MutationObserver để theo dõi khi nào class hidden được thêm vào
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    if (addVocabCard.classList.contains('hidden')) {
                        console.log('FORM WAS HIDDEN! Stack trace:');
                        console.trace();
                    }
                }
            });
        });
        observer.observe(addVocabCard, { attributes: true, attributeFilter: ['class'] });
        
        // Đơn giản hóa: chỉ xử lý click
        floatingBtn.onclick = function(e) {
            console.log('Button clicked!');
            e.preventDefault();
            e.stopPropagation();
            
            if (addVocabCard.classList.contains('hidden')) {
                openAddForm();
            } else {
                closeAddForm();
            }
        };
        
        // Hiển thị button ngay khi setup
        floatingBtn.style.display = 'flex';
        console.log('Floating button setup complete');
    } else {
        console.error('Missing elements:', {
            floatingBtn: !!floatingBtn,
            addVocabCard: !!addVocabCard,
            addVocabForm: !!addVocabForm
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', closeAddForm);
    }

    // Click backdrop để đóng form
    const backdrop = document.getElementById('add-vocab-backdrop');
    if (backdrop) {
        backdrop.addEventListener('click', closeAddForm);
    }

    // ESC key để đóng
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !addVocabCard.classList.contains('hidden')) {
            closeAddForm();
        }
    });

    // Đóng form sau khi thêm từ vựng thành công
    if (addVocabForm) {
        // Create a unique event for floating button form - REMOVED, using main handler instead
        
        // Form submit will be handled by main handler
        console.log('Floating button setup - form handler will be managed by main handler');
    } else {
        console.error('Form not found!');
    }
    
    // Test function để debug
    window.testFloatingButton = function() {
        console.log('=== FLOATING BUTTON TEST ===');
        console.log('Button element:', floatingBtn);
        console.log('Button display:', floatingBtn ? getComputedStyle(floatingBtn).display : 'N/A');
        console.log('Card element:', addVocabCard);
        console.log('Form element:', addVocabForm);
        console.log('Close button:', closeBtn);
        
        if (floatingBtn && addVocabCard) {
            console.log('Manually opening form...');
            openAddForm();
        }
    };
    
    // Test function để test thêm từ vựng
    window.testAddVocab = function() {
        console.log('=== TEST ADD VOCAB ===');
        const testWord = {
            kanji: '水',
            hiragana: 'みず',
            romaji: 'mizu',
            meaning: 'nước',
            lesson: '1'
        };
        
        // Fill form
        document.getElementById('kanji').value = testWord.kanji;
        document.getElementById('hiragana').value = testWord.hiragana;
        document.getElementById('romaji').value = testWord.romaji;
        document.getElementById('meaning').value = testWord.meaning;
        document.getElementById('lesson').value = testWord.lesson;
        
        console.log('Test data filled, submitting...');
        addVocabForm.dispatchEvent(new Event('submit'));
    };
});

document.getElementById('import-excel-btn').addEventListener('click', () => {
    const fileInput = document.getElementById('excelFileInput');
    const file = fileInput.files[0];
    if (!file) {
        alert('Vui lòng chọn file Excel!');
        return;
    }
    const reader = new FileReader();
    reader.onload = function(e) {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(firstSheet);
        let errors = [];
        
        // Temporarily disable auto-sorting during import for performance
        const tempVocabulary = [];
        const maxOriginalIndex = vocabulary.length > 0 ? Math.max(...vocabulary.map(v => v.originalIndex)) : -1;
        
        jsonData.forEach((row, i) => {
            const kanji = row['Kanji'] || '';
            const hiragana = row['Hiragana/Katakana'];
            let romaji = row['Romaji'] || '';
            const meaning = row['Nghĩa'];
            const lesson = row['Bài'].toString();
            if (!hiragana || !meaning || !lesson) {
                errors.push(`Dòng ${i + 1}: Thiếu trường bắt buộc`);
                return;
            }
            
            if (!romaji) romaji = wanakana.toRomaji(hiragana);
            
            // Check for duplicates
            if (vocabulary.some(v => v.kanji === kanji && v.hiragana === hiragana)) {
                errors.push(`Dòng ${i + 1}: Từ vựng đã tồn tại`);
                return;
            }
            
            // Sử dụng originalIndex tiếp theo sau từ vựng hiện có
            const newVocab = { 
                kanji, 
                hiragana, 
                romaji, 
                meaning, 
                lesson, 
                originalIndex: maxOriginalIndex + 1 + i, // Đảm bảo không trùng
                retryCount: 0 
            };
            tempVocabulary.push(newVocab);
        });
        
        // Add all new vocabulary at once
        vocabulary.push(...tempVocabulary);
        localStorage.setItem('vocabulary', JSON.stringify(vocabulary));
        
        // Sort and refresh table once after all imports
        refreshVocabularyTable();
        
        // Cập nhật lesson buttons và các UI khác
        populateLessonButtons();
        updateSelectedVocabCount();
        updateStartQuizButton();
        
        if (errors.length > 0) {
            alert(`Import hoàn tất với ${tempVocabulary.length} từ vựng thành công và ${errors.length} lỗi:\n${errors.join('\n')}`);
        } else {
            alert(`Import thành công ${tempVocabulary.length} từ vựng!`);
        }
        fileInput.value = '';
    };
    reader.readAsArrayBuffer(file);
});

// Tạo function riêng để setup Excel handlers
function setupExcelHandlers() {
    console.log('Setting up Excel handlers...');
    
    // Import Excel handler - di chuyển code vào đây
    const importBtn = document.getElementById('import-excel-btn');
    if (importBtn) {
        // Remove existing listeners to avoid duplicates
        const newImportBtn = importBtn.cloneNode(true);
        importBtn.parentNode.replaceChild(newImportBtn, importBtn);
        
        newImportBtn.addEventListener('click', () => {
            console.log('Import Excel button clicked');
            const fileInput = document.getElementById('excelFileInput');
            
            // Kiểm tra xem user đã chọn file chưa
            if (!fileInput.files || fileInput.files.length === 0) {
                alert('Vui lòng chọn file Excel trước!');
                fileInput.click(); // Mở dialog chọn file
                return;
            }
            
            const file = fileInput.files[0];
            
            // Kiểm tra loại file
            if (!file.name.match(/\.(xlsx|xls)$/i)) {
                alert('Vui lòng chọn file Excel (.xlsx hoặc .xls)!');
                return;
            }
            
            if (typeof XLSX === 'undefined') {
                alert('Lỗi: Thư viện XLSX chưa được load. Vui lòng refresh trang và thử lại.');
                return;
            }
            
            // Hiển thị thông báo đang xử lý
            const originalText = newImportBtn.innerHTML;
            newImportBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang xử lý...';
            newImportBtn.disabled = true;
            
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    const jsonData = XLSX.utils.sheet_to_json(firstSheet);
                    let errors = [];
                    
                    // Temporarily disable auto-sorting during import for performance
                    const tempVocabulary = [];
                    const maxOriginalIndex = vocabulary.length > 0 ? Math.max(...vocabulary.map(v => v.originalIndex)) : -1;
                    
                    jsonData.forEach((row, i) => {
                        const kanji = row['Kanji'] || '';
                        const hiragana = row['Hiragana/Katakana'];
                        let romaji = row['Romaji'] || '';
                        const meaning = row['Nghĩa'];
                        const lesson = row['Bài'];
                        
                        if (!hiragana || !meaning || !lesson) {
                            errors.push(`Dòng ${i + 1}: Thiếu trường bắt buộc (Hiragana/Katakana, Nghĩa, Bài)`);
                            return;
                        }
                        
                        if (!romaji) romaji = wanakana.toRomaji(hiragana);
                        
                        // Check for duplicates
                        if (vocabulary.some(v => v.kanji === kanji && v.hiragana === hiragana)) {
                            errors.push(`Dòng ${i + 1}: Từ vựng đã tồn tại`);
                            return;
                        }
                        
                        // Sử dụng originalIndex tiếp theo sau từ vựng hiện có
                        const newVocab = { 
                            kanji, 
                            hiragana, 
                            romaji, 
                            meaning, 
                            lesson: lesson.toString(),
                            originalIndex: maxOriginalIndex + 1 + i, // Đảm bảo không trùng
                            retryCount: 0 
                        };
                        tempVocabulary.push(newVocab);
                    });
                    
                    // Add all new vocabulary at once
                    vocabulary.push(...tempVocabulary);
                    localStorage.setItem('vocabulary', JSON.stringify(vocabulary));
                    
                    // Sort and refresh table once after all imports
                    refreshVocabularyTable();
                    
                    // Cập nhật lesson buttons và các UI khác
                    populateLessonButtons();
                    updateSelectedVocabCount();
                    updateStartQuizButton();
                    
                    if (errors.length > 0) {
                        alert(`Import hoàn tất với ${tempVocabulary.length} từ vựng thành công và ${errors.length} lỗi:\n${errors.join('\n')}`);
                    } else {
                        alert(`Import thành công ${tempVocabulary.length} từ vựng!`);
                    }
                    fileInput.value = '';
                    
                    // Khôi phục button
                    newImportBtn.innerHTML = originalText;
                    newImportBtn.disabled = false;
                } catch (error) {
                    console.error('Error processing Excel file:', error);
                    alert('Lỗi khi xử lý file Excel: ' + error.message + '\n\nVui lòng kiểm tra:\n- File có đúng format không?\n- Các cột có tên đúng không? (Kanji, Hiragana/Katakana, Romaji, Nghĩa, Bài)');
                    
                    // Khôi phục button
                    newImportBtn.innerHTML = originalText;
                    newImportBtn.disabled = false;
                }
            };
            
            reader.onerror = function() {
                alert('Lỗi khi đọc file. Vui lòng thử lại.');
                newImportBtn.innerHTML = originalText;
                newImportBtn.disabled = false;
            };
            reader.readAsArrayBuffer(file);
        });
    }
    
    // Download Excel handler
    const downloadBtn = document.getElementById('download-excel-btn');
    if (downloadBtn) {
        // Remove existing listeners to avoid duplicates
        const newDownloadBtn = downloadBtn.cloneNode(true);
        downloadBtn.parentNode.replaceChild(newDownloadBtn, downloadBtn);
        
        newDownloadBtn.addEventListener('click', () => {
            console.log('Download Excel button clicked');
            if (typeof XLSX === 'undefined') {
                alert('Lỗi: Thư viện XLSX chưa được load. Vui lòng refresh trang và thử lại.');
                return;
            }
            
            try {
                const worksheet = XLSX.utils.json_to_sheet(vocabulary.map(v => ({
                    Kanji: v.kanji || '',
                    'Hiragana/Katakana': v.hiragana,
                    Romaji: v.romaji,
                    Nghĩa: v.meaning,
                    Bài: v.lesson
                })));
                const workbook = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(workbook, worksheet, 'Từ vựng');
                XLSX.writeFile(workbook, 'vocabulary.xlsx');
                alert('Export thành công!');
            } catch (error) {
                console.error('Error exporting Excel file:', error);
                alert('Lỗi khi export file Excel: ' + error.message);
            }
        });
    }
    
    // Thêm event listener cho file input để hiển thị tên file đã chọn
    const fileInput = document.getElementById('excelFileInput');
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            const importBtn = document.getElementById('import-excel-btn');
            if (e.target.files && e.target.files.length > 0) {
                const fileName = e.target.files[0].name;
                importBtn.innerHTML = `<i class="fas fa-file-import"></i> Nhập ${fileName}`;
            } else {
                importBtn.innerHTML = '<i class="fas fa-file-import"></i> Nhập Excel';
            }
        });
    }
}

wordTableBody.addEventListener('click', (e) => {
    const row = e.target.closest('tr');
    if (e.target.classList.contains('delete-btn')) {
        const word = {
            kanji: row.cells[1].textContent === 'N/A' ? '' : row.cells[1].textContent,
            hiragana: row.cells[2].textContent,
            romaji: row.cells[3].textContent,
            meaning: row.cells[4].textContent,
            lesson: row.cells[5].textContent,
            originalIndex: vocabulary.find(v => v.hiragana === row.cells[2].textContent).originalIndex,
            retryCount: 0
        };
        deleteVocabulary(word, row);
    }
    // Đã xóa phần xử lý edit-btn vì đã có inline editing
});

// Sort vocabulary by original Excel order
document.getElementById('sort-original-btn').addEventListener('click', () => {
    // Reset editing state
    currentEditingRow = null;
    
    // Sort vocabulary by original order
    sortVocabularyByOriginalOrder();
    
    // Clear table
    wordTableBody.innerHTML = '';
    
    // Re-populate table with sorted data
    vocabulary.forEach((word, index) => addToTable(word, 'word', index + 1));
    
    // Update related UI elements
    updateTotalVocab();
    createLessonPreview();
    populateLessonButtons();
    populateLessonDropdown();
    filterVocabularyTable();
    updateVocabCount();
    
    // Hiển thị thông báo
    const notification = document.createElement('div');
    notification.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 5px;">📋 Đã khôi phục thứ tự Excel gốc!</div>
        <div style="font-size: 12px; opacity: 0.9;">
            📊 Thứ tự như trong file Excel ban đầu
        </div>
    `;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #28a745, #20c997);
        color: white;
        padding: 15px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        z-index: 9999;
        font-size: 14px;
        transform: translateX(100%);
        transition: transform 0.3s ease;
        max-width: 300px;
    `;
    
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 100);
    
    // Auto remove
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 3000);
});

document.getElementById('delete-all-vocab-btn').addEventListener('click', () => {
    if (confirm('Bạn có chắc chắn muốn xóa tất cả từ vựng?')) {
        trashBin.push(...vocabulary);
        vocabulary = [];
        localStorage.setItem('vocabulary', JSON.stringify(vocabulary));
        localStorage.setItem('trashBin', JSON.stringify(trashBin));
        wordTableBody.innerHTML = '';
        updateTotalVocab();
        trashBin.forEach(word => addToTable(word, 'trash'));
        populateLessonDropdown();
        filterVocabularyTable();
    }
});

document.getElementById('permanent-delete-all-btn').addEventListener('click', () => {
    if (confirm('Bạn có chắc chắn muốn xóa vĩnh viễn tất cả từ vựng trong thùng rác?')) {
        trashBin = [];
        localStorage.setItem('trashBin', JSON.stringify(trashBin));
        trashTableBody.innerHTML = '';
    }
});

function deleteVocabulary(word, row) {
    const index = vocabulary.findIndex(v => v.hiragana === word.hiragana);
    if (index > -1) {
        vocabulary.splice(index, 1);
        trashBin.push(word);
        localStorage.setItem('vocabulary', JSON.stringify(vocabulary));
        localStorage.setItem('trashBin', JSON.stringify(trashBin));
        row.remove();
        updateTotalVocab();
        addToTable(word, 'trash');
        populateLessonDropdown();
        filterVocabularyTable();
    }
}

trashTableBody.addEventListener('click', (e) => {
    if (e.target.classList.contains('restore-btn')) {
        const row = e.target.closest('tr');
        const word = {
            kanji: row.cells[0].textContent === 'N/A' ? '' : row.cells[0].textContent,
            hiragana: row.cells[1].textContent,
            romaji: row.cells[2].textContent,
            meaning: row.cells[3].textContent,
            lesson: row.cells[4].textContent,
            originalIndex: trashBin.find(v => v.hiragana === row.cells[1].textContent).originalIndex,
            retryCount: 0
        };
        restoreVocabulary(word, row);
    }
});

function restoreVocabulary(word, row) {
    const index = trashBin.findIndex(v => v.hiragana === word.hiragana);
    if (index > -1) {
        trashBin.splice(index, 1);
        
        // Tìm vị trí phù hợp để chèn từ vựng khôi phục dựa trên bài học
        const restoredLessonNum = parseInt(word.lesson) || 999;
        let insertIndex = vocabulary.length; // Mặc định thêm vào cuối
        
        // Tìm vị trí cuối cùng của bài học cùng loại hoặc bài học nhỏ hơn
        for (let i = vocabulary.length - 1; i >= 0; i--) {
            const currentLessonNum = parseInt(vocabulary[i].lesson) || 999;
            if (currentLessonNum <= restoredLessonNum) {
                insertIndex = i + 1;
                break;
            }
            if (i === 0) {
                insertIndex = 0;
            }
        }
        
        // Chèn từ vựng vào vị trí phù hợp
        vocabulary.splice(insertIndex, 0, word);
        
        // Cập nhật lại tất cả originalIndex để đảm bảo thứ tự đúng
        vocabulary.forEach((word, index) => {
            word.originalIndex = index;
        });
        
        localStorage.setItem('vocabulary', JSON.stringify(vocabulary));
        localStorage.setItem('trashBin', JSON.stringify(trashBin));
        row.remove();
        
        // Refresh table without sorting
        refreshVocabularyTableWithoutSort();
    }
}

document.getElementById('show-trash-btn').addEventListener('click', () => showSection('trash'));
document.getElementById('close-trash-btn').addEventListener('click', () => showSection('vocab'));

// Xử lý Quiz
const quizKanji = document.getElementById('quiz-kanji');
const quizMeaning = document.getElementById('quiz-meaning');
const optionBtns = document.querySelectorAll('.option-btn');
const quizFeedback = document.getElementById('quiz-feedback');
let currentQuizHiragana = '';
let currentQuizIndex = -1;

document.getElementById('back-to-lessons').addEventListener('click', () => {
    // Không lưu tiến độ khi quay lại chọn bài học - xóa trạng thái quiz
    localStorage.removeItem('quizState');
    currentQuestion = null;
    currentOptions = [];
    filteredVocab = [];
    correctWords.clear();
    retryQueue = [];
    
    document.getElementById('lesson-selection').classList.remove('hidden');
    document.querySelector('.quiz-card').classList.add('hidden');
});

document.getElementById('select-all-btn').addEventListener('click', () => {
    const cards = document.querySelectorAll('.lesson-card');
    cards.forEach(card => card.classList.add('selected'));
    updateStartQuizButton();
    updateSelectedVocabCount();
});

// Hàm hiển thị lại câu hỏi hiện tại mà không tạo câu hỏi mới
function displayCurrentQuestion() {
    if (!currentQuestion) return;

    // Hiển thị câu hỏi: nếu có kanji thì hiển thị kanji, không thì hiển thị nghĩa tiếng Việt
    if (currentQuestion.kanji && currentQuestion.kanji.trim() !== '') {
        quizKanji.textContent = currentQuestion.kanji;
    } else {
        quizKanji.textContent = currentQuestion.meaning;
    }
    
    quizMeaning.textContent = currentQuestion.meaning;
    currentQuizHiragana = currentQuestion.hiragana;

    // Sử dụng đáp án đã có nếu tồn tại, nếu không thì tạo mới
    if (!currentOptions || currentOptions.length === 0) {
        generateQuizOptions();
    }

    const correctOption = currentQuestion.hiragana;
    optionBtns.forEach((btn, index) => {
        btn.textContent = currentOptions[index];
        btn.disabled = false;
        btn.classList.remove('correct', 'incorrect');
        btn.onclick = () => checkAnswer(btn, correctOption);
    });

    quizFeedback.textContent = '';
}

// Hàm tạo đáp án mới
function generateQuizOptions() {
    const correctOption = currentQuestion.hiragana;
    const similarOptions = getSimilarWords(currentQuestion, filteredVocab, 3);
    const options = [correctOption, ...similarOptions.map(opt => opt.hiragana)];
    while (options.length < 4) {
        const randomOption = filteredVocab[Math.floor(Math.random() * filteredVocab.length)].hiragana;
        if (!options.includes(randomOption)) options.push(randomOption);
    }

    // Luôn xáo trộn đáp án để tránh đáp án đúng luôn ở vị trí A
    // Chức năng random chỉ ảnh hưởng đến thứ tự câu hỏi, không phải đáp án
    options.sort(() => Math.random() - 0.5);
    
    currentOptions = options;
}

function loadQuiz() {
    if (filteredVocab.length < 4) {
        alert('Có lỗi: Không đủ từ vựng để tiếp tục quiz.');
        showSection('quiz');
        return;
    }

    if (retryQueue.length && questionsSinceLastRetry >= retryInterval) {
        currentQuestion = retryQueue.shift();
        questionsSinceLastRetry = 0;
    } else {
        if (isRandomized) {
            let randomIndex;
            do {
                randomIndex = Math.floor(Math.random() * filteredVocab.length);
            } while (filteredVocab[randomIndex] === currentQuestion);
            currentQuestion = filteredVocab[randomIndex];
        } else {
            currentQuizIndex = (currentQuizIndex + 1) % filteredVocab.length;
            currentQuestion = filteredVocab[currentQuizIndex];
        }
    }

    // Tạo đáp án mới và hiển thị câu hỏi
    generateQuizOptions();
    displayCurrentQuestion();
    
    // Auto pronunciation if enabled
    const autoPronunciation = localStorage.getItem('autoPronunciation') === 'true';
    if (autoPronunciation && currentQuestion) {
        setTimeout(() => {
            playAudio(currentQuestion.hiragana);
        }, 500); // Delay 500ms để UX mượt hơn
    }
    
    saveQuizState();
}

function getSimilarWords(correctWord, allWords, numOptions = 3) {
    const similarWords = allWords.filter(word => word.hiragana !== correctWord.hiragana && (
        word.hiragana.startsWith(correctWord.hiragana[0]) ||
        word.hiragana.endsWith(correctWord.hiragana.slice(-1)) ||
        (word.kanji && correctWord.kanji && word.kanji.includes(correctWord.kanji[0]))
    ));
    const shuffled = similarWords.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, numOptions);
}

function checkAnswer(selectedBtn, correct) {
    const selected = selectedBtn.textContent;
    optionBtns.forEach(btn => {
        btn.disabled = true;
        if (btn.textContent === correct) btn.classList.add('correct');
        else if (btn === selectedBtn) btn.classList.add('incorrect');
    });

    if (selected === correct) {
        if (!correctWords.has(currentQuestion.originalIndex)) correctWords.add(currentQuestion.originalIndex);
        quizFeedback.innerHTML = `Đúng rồi! ${currentQuestion.hiragana} <span style="color: #1e90ff;">(${currentQuestion.romaji})</span>`;
        quizFeedback.style.color = '#28a745';
        playCorrectSound(); // Use optimized sound function
        currentQuestion.retryCount = 0;
        
        // Tự động chuyển sang câu tiếp theo nếu bật tính năng auto-continue
        if (isAutoContinue) {
            setTimeout(() => {
                loadQuiz();
            }, 1500); // Đợi 1.5 giây để người dùng thấy phản hồi
        }
    } else {
        quizFeedback.innerHTML = `Sai rồi! Đáp án: ${correct} <span style="color: #1e90ff;">(${currentQuestion.romaji})</span>`;
        quizFeedback.style.color = '#dc3545';
        playIncorrectSound(); // Use optimized sound function
        if (currentQuestion.retryCount < retryMax) {
            currentQuestion.retryCount++;
            if (!retryQueue.includes(currentQuestion)) retryQueue.push(currentQuestion);
        }
    }

    questionsSinceLastRetry++;
    updateProgressBar();
    saveQuizState();
}

function playQuizAudio() {
    playAudio(quizKanji.textContent);
}

document.getElementById('quiz-next').addEventListener('click', loadQuiz);
document.getElementById('quiz-restart').addEventListener('click', () => {
    retryQueue = [];
    correctWords.clear();
    currentOptions = [];
    currentQuizIndex = -1;
    loadQuiz();
    updateProgressBar();
});

document.getElementById('show-meaning-btn').addEventListener('click', () => {
    isMeaningAlwaysVisible = !isMeaningAlwaysVisible;
    document.getElementById('show-meaning-btn').classList.toggle('active', isMeaningAlwaysVisible);
    quizMeaning.classList.toggle('hidden', !isMeaningAlwaysVisible);
    saveQuizState();
});

function playAudio(text) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ja-JP';
    speechSynthesis.speak(utterance);
}

// Optimized click sound system
let clickSoundPool = [];
let clickSoundIndex = 0;
let correctSoundPool = [];
let incorrectSoundPool = [];

// Initialize audio pools for better performance
function initializeAudioSounds() {
    // Create multiple audio instances to avoid delay
    for (let i = 0; i < 3; i++) {
        // Click sound pool
        const clickAudio = new Audio('sound/click.mp3');
        clickAudio.preload = 'auto';
        clickAudio.volume = 0.3; // Reduce volume
        clickAudio.load();
        clickSoundPool.push(clickAudio);
        
        // Correct sound pool
        const correctAudio = new Audio('sound/correct.mp3');
        correctAudio.preload = 'auto';
        correctAudio.volume = 0.5;
        correctAudio.load();
        correctSoundPool.push(correctAudio);
        
        // Incorrect sound pool
        const incorrectAudio = new Audio('sound/incorrect.mp3');
        incorrectAudio.preload = 'auto';
        incorrectAudio.volume = 0.5;
        incorrectAudio.load();
        incorrectSoundPool.push(incorrectAudio);
    }
}

// Optimized sound functions với settings integration
function playClickSound() {
    const soundEnabled = localStorage.getItem('soundEnabled') !== 'false';
    if (!soundEnabled) return;
    
    try {
        const audio = clickSoundPool[clickSoundIndex];
        if (audio && audio.readyState >= 2) {
            audio.currentTime = 0;
            audio.play().catch(e => console.log('Click sound failed:', e));
        }
        clickSoundIndex = (clickSoundIndex + 1) % clickSoundPool.length;
    } catch (error) {
        console.log('Click sound error:', error);
    }
}

function playCorrectSound() {
    const soundEnabled = localStorage.getItem('soundEnabled') !== 'false';
    if (!soundEnabled) return;
    
    try {
        const audio = correctSoundPool[0]; // Use first available
        if (audio && audio.readyState >= 2) {
            audio.currentTime = 0;
            audio.play().catch(e => console.log('Correct sound failed:', e));
        }
    } catch (error) {
        console.log('Correct sound error:', error);
    }
}

function playIncorrectSound() {
    const soundEnabled = localStorage.getItem('soundEnabled') !== 'false';
    if (!soundEnabled) return;
    
    try {
        const audio = incorrectSoundPool[0]; // Use first available
        if (audio && audio.readyState >= 2) {
            audio.currentTime = 0;
            audio.play().catch(e => console.log('Incorrect sound failed:', e));
        }
    } catch (error) {
        console.log('Incorrect sound error:', error);
    }
}

// Initialize sounds when page loads
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initializeAudioSounds, 500); // Delay to ensure page is ready
});

const clickSoundButtons = document.querySelectorAll('.nav-item, .navigation button, #quick-quiz, #quick-add-vocab, #reset-vocab');
clickSoundButtons.forEach(button => {
    button.addEventListener('click', playClickSound);
});

document.getElementById('randomize-options-btn').addEventListener('click', (e) => {
    isRandomized = !isRandomized;
    
    // Lưu cài đặt vào localStorage
    localStorage.setItem('isRandomized', isRandomized.toString());
    
    const button = e.target.closest('.setting-toggle');
    const status = document.getElementById('randomize-status');
    
    if (isRandomized) {
        button.classList.add('active');
        status.textContent = 'Bật';
    } else {
        button.classList.remove('active');
        status.textContent = 'Tắt';
    }
    
    // Chỉ reset quiz nếu đang có quiz chạy
    if (currentQuestion && filteredVocab.length > 0) {
        // Xác nhận trước khi reset quiz
        const confirmReset = confirm('Thay đổi cài đặt sẽ reset quiz hiện tại. Bạn có muốn tiếp tục?');
        
        if (confirmReset) {
            // Reset quiz với cài đặt mới
            retryQueue = [];
            correctWords.clear();
            currentOptions = [];
            currentQuizIndex = -1;
            loadQuiz();
            updateProgressBar();
            
            // Hiển thị thông báo
            showNotification('Quiz đã được reset với cài đặt mới!', 'success');
        } else {
            // Hoàn tác thay đổi nếu người dùng không đồng ý
            isRandomized = !isRandomized;
            localStorage.setItem('isRandomized', isRandomized.toString());
            
            // Cập nhật lại giao diện
            if (isRandomized) {
                button.classList.add('active');
                status.textContent = 'Bật';
            } else {
                button.classList.remove('active');
                status.textContent = 'Tắt';
            }
        }
    }
});

document.getElementById('auto-continue-btn').addEventListener('click', (e) => {
    isAutoContinue = !isAutoContinue;
    
    // Lưu cài đặt vào localStorage
    localStorage.setItem('isAutoContinue', isAutoContinue.toString());
    
    const button = e.target.closest('.setting-toggle');
    const status = document.getElementById('auto-continue-status');
    
    if (isAutoContinue) {
        button.classList.add('active');
        status.textContent = 'Bật';
        showNotification('Tự động tiếp tục đã được bật!', 'success');
    } else {
        button.classList.remove('active');
        status.textContent = 'Tắt';
        showNotification('Tự động tiếp tục đã được tắt!', 'info');
    }
});

// Thêm event listeners cho các settings mới
document.addEventListener('DOMContentLoaded', () => {
    // Sound Effects Setting
    const soundBtn = document.getElementById('sound-effects-btn');
    const soundStatus = document.getElementById('sound-status');
    let soundEnabled = localStorage.getItem('soundEnabled') !== 'false'; // Default true
    
    function updateSoundSetting() {
        if (soundEnabled) {
            soundBtn.classList.add('active');
            soundStatus.textContent = 'Bật';
        } else {
            soundBtn.classList.remove('active');
            soundStatus.textContent = 'Tắt';
        }
        localStorage.setItem('soundEnabled', soundEnabled.toString());
    }
    
    if (soundBtn) {
        updateSoundSetting();
        soundBtn.addEventListener('click', () => {
            soundEnabled = !soundEnabled;
            updateSoundSetting();
            showNotification(soundEnabled ? 'Đã bật âm thanh' : 'Đã tắt âm thanh', 'success');
        });
    }
    
    // Auto Pronunciation Setting  
    const pronunciationBtn = document.getElementById('auto-pronunciation-btn');
    const pronunciationStatus = document.getElementById('pronunciation-status');
    let autoPronunciation = localStorage.getItem('autoPronunciation') === 'true'; // Default false
    
    function updatePronunciationSetting() {
        if (autoPronunciation) {
            pronunciationBtn.classList.add('active');
            pronunciationStatus.textContent = 'Bật';
        } else {
            pronunciationBtn.classList.remove('active');
            pronunciationStatus.textContent = 'Tắt';
        }
        localStorage.setItem('autoPronunciation', autoPronunciation.toString());
    }
    
    if (pronunciationBtn) {
        updatePronunciationSetting();
        pronunciationBtn.addEventListener('click', () => {
            autoPronunciation = !autoPronunciation;
            updatePronunciationSetting();
            showNotification(autoPronunciation ? 'Đã bật phát âm tự động' : 'Đã tắt phát âm tự động', 'success');
        });
    }
    
    // Export Progress Button
    const exportBtn = document.getElementById('export-progress-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            const progressData = {
                vocabulary: vocabulary,
                correctWords: Array.from(correctWords),
                settings: {
                    isRandomized: isRandomized,
                    retryInterval: retryInterval,
                    retryMax: retryMax,
                    soundEnabled: soundEnabled,
                    autoPronunciation: autoPronunciation
                },
                exportDate: new Date().toISOString()
            };
            
            const dataStr = JSON.stringify(progressData, null, 2);
            const dataBlob = new Blob([dataStr], {type: 'application/json'});
            const url = URL.createObjectURL(dataBlob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `japanese-learning-progress-${new Date().toISOString().split('T')[0]}.json`;
            link.click();
            URL.revokeObjectURL(url);
            
            showNotification('Đã xuất dữ liệu tiến độ thành công!', 'success');
        });
    }
    
    // Reset Progress Button
    const resetBtn = document.getElementById('reset-progress-btn');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            const confirmReset = confirm('⚠️ CẢNH BÁO: Thao tác này sẽ xóa toàn bộ tiến độ học tập của bạn!\n\nBạn có chắc chắn muốn tiếp tục?');
            
            if (confirmReset) {
                const doubleConfirm = confirm('Xác nhận lần cuối: Bạn có thực sự muốn xóa tất cả tiến độ học tập?');
                
                if (doubleConfirm) {
                    // Reset all progress data
                    correctWords.clear();
                    retryQueue = [];
                    currentQuestion = null;
                    currentOptions = [];
                    currentQuizIndex = -1;
                    
                    // Reset vocabulary retry counts
                    vocabulary.forEach(word => {
                        word.retryCount = 0;
                    });
                    localStorage.setItem('vocabulary', JSON.stringify(vocabulary));
                    
                    // Clear quiz state
                    localStorage.removeItem('quizState');
                    
                    // Reset UI
                    updateProgressBar();
                    
                    // Show success message
                    showNotification('Đã reset toàn bộ tiến độ học tập!', 'success');
                    
                    // Return to home if in quiz
                    const quizSection = document.getElementById('quiz-section');
                    if (quizSection && !quizSection.classList.contains('hidden')) {
                        showSection('home');
                    }
                }
            }
        });
    }
});

document.getElementById('quick-quiz').addEventListener('click', () => showSection('quiz'));
document.getElementById('quick-add-vocab').addEventListener('click', () => showSection('vocab'));

document.getElementById('reset-vocab').addEventListener('click', () => {
    if (confirm('Bạn có chắc chắn muốn reset từ vựng về mặc định?')) {
        fetch('default.xlsx')
            .then(response => response.arrayBuffer())
            .then(data => {
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const jsonData = XLSX.utils.sheet_to_json(firstSheet);
                vocabulary = jsonData.map((row, index) => {
                    let romaji = row['Romaji'] || wanakana.toRomaji(row['Hiragana/Katakana']);
                    return {
                        kanji: row['Kanji'] || '',
                        hiragana: row['Hiragana/Katakana'],
                        romaji: romaji,
                        meaning: row['Nghĩa'],
                        lesson: row['Bài'].toString(),
                        originalIndex: index,
                        retryCount: 0
                    };
                });
                localStorage.setItem('vocabulary', JSON.stringify(vocabulary));
                
                // Đánh dấu vocabulary đã được load
                isVocabularyLoaded = true;
                
                // Auto-sort and refresh after reset
                refreshVocabularyTable();
                alert('Đã reset từ vựng về mặc định.');
            });
    }
});

// Hàm lưu trạng thái quiz
function saveQuizState() {
    const selectedCards = document.querySelectorAll('.lesson-card.selected');
    const selectedLessons = Array.from(selectedCards).map(card => card.dataset.lesson);
    
    const quizState = {
        filteredVocab: filteredVocab.map(word => word.originalIndex),
        correctWords: Array.from(correctWords),
        retryQueue: retryQueue.map(word => word.originalIndex),
        currentQuestion: currentQuestion ? currentQuestion.originalIndex : null,
        currentOptions: currentOptions,
        currentQuizIndex: currentQuizIndex,
        questionsSinceLastRetry: questionsSinceLastRetry,
        isRandomized: isRandomized,
        isMeaningAlwaysVisible: isMeaningAlwaysVisible,
        selectedLessons: selectedLessons // Lưu thông tin bài học đã chọn
    };
    localStorage.setItem('quizState', JSON.stringify(quizState));
}

// Hàm khôi phục trạng thái quiz
function restoreQuizState() {
    // Kiểm tra vocabulary đã được load chưa
    if (!isVocabularyLoaded || vocabulary.length === 0) {
        return false;
    }
    
    const quizState = JSON.parse(localStorage.getItem('quizState'));
    if (quizState) {
        // Lọc ra những từ vựng không còn tồn tại
        filteredVocab = quizState.filteredVocab
            .map(index => vocabulary.find(word => word.originalIndex === index))
            .filter(word => word !== undefined);
            
        correctWords = new Set(quizState.correctWords);
        
        retryQueue = quizState.retryQueue
            .map(index => vocabulary.find(word => word.originalIndex === index))
            .filter(word => word !== undefined);
            
        currentQuestion = quizState.currentQuestion ? 
            vocabulary.find(word => word.originalIndex === quizState.currentQuestion) : null;
            
        currentOptions = quizState.currentOptions || [];
        currentQuizIndex = quizState.currentQuizIndex;
        questionsSinceLastRetry = quizState.questionsSinceLastRetry;
        
        // Chỉ cập nhật isRandomized nếu có quiz đang chạy
        if (currentQuestion) {
            isRandomized = quizState.isRandomized;
        }
        
        isMeaningAlwaysVisible = quizState.isMeaningAlwaysVisible;
        
        // Khôi phục hiển thị thông tin bài học nếu có
        if (quizState.selectedLessons && quizState.selectedLessons.length > 0) {
            displayQuizLessonInfo(quizState.selectedLessons);
        }

        updateProgressBar();
        if (currentQuestion && filteredVocab.length > 0) {
            displayCurrentQuestion();
            if (isMeaningAlwaysVisible) {
                document.getElementById('quiz-meaning').classList.remove('hidden');
                document.getElementById('show-meaning-btn').classList.add('active');
            } else {
                document.getElementById('quiz-meaning').classList.add('hidden');
                document.getElementById('show-meaning-btn').classList.remove('active');
            }
            return true; // Trả về true nếu khôi phục thành công
        }
    }
    return false; // Trả về false nếu không có quiz để khôi phục
}

// Hàm điền danh sách bài học vào dropdown
function populateLessonDropdown() {
    const lessonSelect = document.getElementById('lesson-select');
    const lessons = [...new Set(vocabulary.map(word => word.lesson))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    while (lessonSelect.options.length > 1) {
        lessonSelect.remove(1);
    }
    lessons.forEach(lesson => {
        const option = document.createElement('option');
        option.value = lesson;
        const lessonLabel = isNaN(lesson) ? lesson : `Bài ${lesson}`;
        option.textContent = lessonLabel;
        lessonSelect.appendChild(option);
    });
}

// Hàm lọc bảng từ vựng dựa trên bài học được chọn
function filterVocabularyTable() {
    const selectedLesson = document.getElementById('lesson-select').value;
    const rows = wordTableBody.querySelectorAll('tr');
    rows.forEach(row => {
        const lessonCell = row.cells[5].textContent;
        if (selectedLesson === 'all' || lessonCell === selectedLesson) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
    updateVocabCount(); // Update count after filtering
}

document.getElementById('lesson-select').addEventListener('change', filterVocabularyTable);

// Cập nhật số lượng từ vựng đã chọn trong phần Quiz
function updateSelectedVocabCount() {
    const selectedCards = document.querySelectorAll('.lesson-card.selected');
    const selectedLessons = Array.from(selectedCards).map(card => card.dataset.lesson);
    const filteredVocabTemp = vocabulary.filter(word => selectedLessons.includes(word.lesson.toString()));
    const selectedCount = filteredVocabTemp.length;
    document.getElementById('selected-vocab-count').textContent = `Đã chọn: ${selectedCount} từ vựng`;
}
function populateFlashcardLessonButtons() {
    const lessons = [...new Set(vocabulary.map(word => word.lesson))].sort((a, b) => a - b);
    const lessonButtonsContainer = document.getElementById('flashcard-lesson-buttons');
    lessonButtonsContainer.innerHTML = '';
    lessons.forEach(lesson => {
        const button = document.createElement('button');
        const lessonLabel = isNaN(lesson) ? lesson : `Bài ${lesson}`;
        button.textContent = lessonLabel;
        button.dataset.lesson = lesson;
        button.addEventListener('click', () => {
            button.classList.toggle('selected');
        });
        lessonButtonsContainer.appendChild(button);
    });
}

// Hiệu ứng scroll cho navigation menu
function handleNavScroll() {
    const nav = document.querySelector('.main-nav');
    const header = document.querySelector('.main-header');
    
    if (!nav || !header) return;
    
    const headerHeight = header.offsetHeight;
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    
    if (scrollTop > headerHeight) {
        nav.classList.add('scrolled');
    } else {
        nav.classList.remove('scrolled');
    }
}

// Thêm event listener cho scroll
window.addEventListener('scroll', handleNavScroll);

// Khởi tạo trạng thái nút setting
function initializeSettings() {
    // Random options button
    const randomButton = document.getElementById('randomize-options-btn');
    const randomStatus = document.getElementById('randomize-status');
    
    if (randomButton && randomStatus) {
        if (isRandomized) {
            randomButton.classList.add('active');
            randomStatus.textContent = 'Bật';
        } else {
            randomButton.classList.remove('active');
            randomStatus.textContent = 'Tắt';
        }
    }
    
    // Auto-continue button
    const autoContinueButton = document.getElementById('auto-continue-btn');
    const autoContinueStatus = document.getElementById('auto-continue-status');
    
    if (autoContinueButton && autoContinueStatus) {
        if (isAutoContinue) {
            autoContinueButton.classList.add('active');
            autoContinueStatus.textContent = 'Bật';
        } else {
            autoContinueButton.classList.remove('active');
            autoContinueStatus.textContent = 'Tắt';
        }
    }
}

// Gọi function khi trang load để set trạng thái ban đầu
document.addEventListener('DOMContentLoaded', () => {
    handleNavScroll();
    initializeSettings();
});

// ========================================
// VOCAB SEARCH FUNCTIONALITY
// ========================================

// Function to filter vocabulary table based on search
function searchVocabulary() {
    const searchTerm = document.getElementById('vocab-search').value.toLowerCase().trim();
    const table = document.getElementById('wordTable');
    const rows = table.getElementsByTagName('tr');
    
    // Skip header row (index 0)
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const cells = row.getElementsByTagName('td');
        
        if (cells.length >= 5) {
            const kanji = cells[0].textContent.toLowerCase();
            const hiragana = cells[1].textContent.toLowerCase();
            const romaji = cells[2].textContent.toLowerCase();
            const meaning = cells[3].textContent.toLowerCase();
            const lesson = cells[4].textContent.toLowerCase();
            
            // Search in all fields
            const isMatch = searchTerm === '' ||
                kanji.includes(searchTerm) ||
                hiragana.includes(searchTerm) ||
                romaji.includes(searchTerm) ||
                meaning.includes(searchTerm) ||
                lesson.includes(searchTerm);
            
            row.style.display = isMatch ? '' : 'none';
        }
    }
    
    // Update visible count
    updateVocabCount();
}

// Function to clear search
function clearSearch() {
    const searchInput = document.getElementById('vocab-search');
    searchInput.value = '';
    searchVocabulary(); // Re-filter to show all
}

// Function to update vocabulary count display
function updateVocabCount() {
    const table = document.getElementById('wordTable');
    const rows = table.getElementsByTagName('tr');
    let visibleCount = 0;
    
    // Count visible rows (skip header)
    for (let i = 1; i < rows.length; i++) {
        if (rows[i].style.display !== 'none') {
            visibleCount++;
        }
    }
    
    // Update display
    const totalCount = rows.length - 1; // Subtract header row
    const countDisplay = document.getElementById('vocab-count-display');
    if (countDisplay) {
        countDisplay.textContent = `Hiển thị: ${visibleCount}/${totalCount} từ vựng`;
    }
}

// Main form submit handler - chỉ để thêm từ vựng mới
function handleMainFormSubmit(e) {
    e.preventDefault();
    e.stopPropagation();
    console.log('Main form submitted - Add new vocabulary');
    
    try {
        // Lấy dữ liệu từ form
        const kanjiValue = document.getElementById('kanji').value.trim();
        const hiraganaValue = document.getElementById('hiragana').value.trim();
        const romajiValue = document.getElementById('romaji').value.trim() || 
            (typeof wanakana !== 'undefined' ? wanakana.toRomaji(hiraganaValue) : hiraganaValue);
        const meaningValue = document.getElementById('meaning').value.trim();
        const lessonValue = document.getElementById('lesson').value.trim();

        console.log('Form values:', { kanjiValue, hiraganaValue, romajiValue, meaningValue, lessonValue });

        if (!hiraganaValue || !meaningValue || !lessonValue) {
            alert('Vui lòng điền đầy đủ các trường bắt buộc.');
            return;
        }

        // Add new word
        const newWord = {
            kanji: kanjiValue,
            hiragana: hiraganaValue,
            romaji: romajiValue,
            meaning: meaningValue,
            lesson: lessonValue,
            originalIndex: vocabulary.length,
            retryCount: 0
        };

        console.log('Adding new word:', newWord);
        vocabulary.push(newWord);
        localStorage.setItem('vocabulary', JSON.stringify(vocabulary));
        
        // Refresh table
        if (typeof refreshVocabularyTable === 'function') {
            refreshVocabularyTable();
            console.log('Table refreshed');
        } else {
            console.error('refreshVocabularyTable function not found');
        }
        
        // Hiển thị thông báo thành công
        if (typeof showNotification === 'function') {
            showNotification('Đã thêm từ vựng thành công!', 'success');
        } else {
            console.log('showNotification function not available, using alert');
            alert('Đã thêm từ vựng thành công!');
        }
        
        console.log('New word added successfully');
        
        // Reset form
        document.getElementById('add-vocab-form').reset();
        
        // Đóng floating form nếu có
        const addVocabCard = document.getElementById('add-vocab-card');
        if (addVocabCard && !addVocabCard.classList.contains('hidden')) {
            const backdrop = document.getElementById('add-vocab-backdrop');
            const formTitle = document.getElementById('form-title');
            const submitBtn = document.getElementById('submit-btn');
            
            addVocabCard.classList.add('hidden');
            if (backdrop) backdrop.classList.remove('show');
            
            // Reset text to add mode
            if (formTitle) {
                formTitle.innerHTML = '<i class="fas fa-plus-circle"></i> Thêm từ vựng mới';
            }
            if (submitBtn) {
                submitBtn.innerHTML = '<i class="fas fa-plus"></i> Thêm từ vựng';
            }
            
            const floatingBtn = document.getElementById('floating-add-btn');
            if (floatingBtn) {
                floatingBtn.innerHTML = '<i class="fas fa-plus"></i>';
            }
        }
        
        console.log('Form submitted successfully');
        
    } catch (error) {
        console.error('Error handling form:', error);
        alert('Có lỗi khi xử lý form: ' + error.message);
    }
}

// Add event listeners for search functionality
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('vocab-search');
    const clearBtn = document.getElementById('clear-search-btn');
    const addVocabForm = document.getElementById('add-vocab-form');
    
    // Setup main form handler
    if (addVocabForm) {
        // Remove any existing listeners first
        addVocabForm.removeEventListener('submit', handleMainFormSubmit);
        addVocabForm.addEventListener('submit', handleMainFormSubmit);
        console.log('Main form handler attached');
    }
    
    if (searchInput) {
        // Real-time search as user types
        searchInput.addEventListener('input', searchVocabulary);
        
        // Search on Enter key
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                searchVocabulary();
            }
        });
    }
    
    if (clearBtn) {
        clearBtn.addEventListener('click', clearSearch);
    }
    
    // Initial count update
    updateVocabCount();
});

// Help Modal Setup
function setupHelpModal() {
    const helpNavItem = document.getElementById('nav-help');
    const helpModal = document.getElementById('help-modal');
    const helpCloseBtn = document.getElementById('help-close-btn');
    
    if (helpNavItem) {
        helpNavItem.addEventListener('click', () => {
            helpModal.classList.add('show');
            document.body.style.overflow = 'hidden'; // Prevent background scroll
        });
    }
    
    if (helpCloseBtn) {
        helpCloseBtn.addEventListener('click', closeHelpModal);
    }
    
    // Close modal when clicking outside
    if (helpModal) {
        helpModal.addEventListener('click', (e) => {
            if (e.target === helpModal) {
                closeHelpModal();
            }
        });
    }
    
    // Close modal with Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && helpModal.classList.contains('show')) {
            closeHelpModal();
        }
    });
    
    function closeHelpModal() {
        helpModal.classList.remove('show');
        document.body.style.overflow = ''; // Restore scroll
    }
}
