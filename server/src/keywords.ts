import * as fs from 'fs';
import * as path from 'path';

export function tryUpdateKeywords() {
    const keywordsPath = path.join(__dirname, '../../keywords.json');
    const tmLanguagePath = path.join(__dirname, '../../.tmLanguage.json');
    const keywordsData = JSON.parse(fs.readFileSync(keywordsPath, 'utf-8'));
    const keywords = Object.keys(keywordsData);
    const keywordsPattern = `\\b(${keywords.join('|')})\\b`;
    const tmLanguageData = JSON.parse(fs.readFileSync(tmLanguagePath, 'utf-8'));

    if (tmLanguageData.repository.keywords.patterns[0].match !== keywordsPattern) {
        tmLanguageData.repository.keywords.patterns[0].match = keywordsPattern;
        fs.writeFileSync(tmLanguagePath, JSON.stringify(tmLanguageData, null, 2), 'utf-8');
        console.info('Updated .tmLanguage.json with new keywords pattern. Please restart the client to apply the changes.');
    }
}