import pngToIco from 'png-to-ico';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function createIcon() {
  try {
    console.log('🎨 Création de l\'icône à partir de SealCircle.png...');
    
    const inputPath = path.join(__dirname, 'app', 'assets', 'images', 'SealCircle.png');
    const outputPath = path.join(__dirname, 'build', 'icon.ico');
    
    // Vérifier si le fichier source existe
    if (!fs.existsSync(inputPath)) {
      console.error('❌ Erreur : SealCircle.png n\'existe pas !');
      process.exit(1);
    }
    
    // Créer l'icône avec plusieurs résolutions (16, 24, 32, 48, 64, 128, 256)
    const buf = await pngToIco(inputPath);
    
    // Sauvegarder le fichier
    fs.writeFileSync(outputPath, buf);
    
    console.log('✅ Icône créée avec succès : build/icon.ico');
    console.log('✅ L\'icône contient plusieurs résolutions jusqu\'à 256x256');
  } catch (error) {
    console.error('❌ Erreur lors de la création de l\'icône :', error.message);
    process.exit(1);
  }
}

createIcon();
