import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, requestUrl } from 'obsidian';
// Remember to rename these classes and interfaces!

interface MoviePluginSettings {
	omdbapikey: string;
	youtubeapikey: string;
	template: string;
	mainPath: string;
	assetPath: string;
	fileName: string;
	imageSize: number;
}

const extractMovieUrl = "https://www.omdbapi.com/?apikey={key}&";
const youtubeApiUrl = "https://www.googleapis.com/youtube/v3/search?key={key}&type=video&maxResults=1&videoEmbeddable=true&q=";

const DEFAULT_SETTINGS: MoviePluginSettings = {
	omdbapikey: "",
	youtubeapikey: "",
	template: "{{Poster}}\n**Length:** {{Runtime}}\n**Genre:** {{Genre}}\n**Actors:** {{Actors}}\n**Year:** {{Year}}\n**IMDB Score:** {{imdbRating}} ({{imdbVotes}})\n\n{{Plot}}\n\n{{Trailer}}",
	mainPath: "movies",
	assetPath: "assets",
	fileName: "{{Title}}",
	imageSize: 200,
}

export default class MoviePlugin extends Plugin {
	settings: MoviePluginSettings;
	youtubeApiUrl: string;
	omdbApiUrl: string;

	async addImageToAssets(url: string, fileName: string) {
		const { vault } = this.app;
		const assetsPath = this.settings.assetPath;
		const response = await requestUrl(url);
		const arrayBuffer = response.arrayBuffer;
		await vault.createBinary(assetsPath + "/" + fileName, arrayBuffer);
	}

	async getTrailerOnYoutube(title: string) {
		const url = this.youtubeApiUrl + title + " trailer";
		let response = await requestUrl({
			url: url,
			method: "GET",
		});
		response = response.json.items[0].id.videoId;
		return response;
	}

	async formatter(data: any, template: string) {
		for (const key in data) {
			if (Object.prototype.hasOwnProperty.call(data, key) && key !== "Poster" && key !== "Trailer" && key !== "Runtime") {
				const value = data[key];
				template = template.replace(`{{${key}}}`, value);
			}
		}
		// format runtime
		if (data.Runtime && data.Runtime !== "N/A") {
			const minute = parseInt(data.Runtime.split(" ")[0]);
			const hour = Math.floor(minute / 60);
			const minuteLeft = minute % 60;
			template = template.replace("{{Runtime}}", `${hour}h ${minuteLeft}m`);
		} else {
			template = template.replace("{{Runtime}}", "-");
		}
		// format poster
		if (data.Poster && data.Poster !== "N/A") {
			const fileName = this.settings.fileName.replace("{{Title}}", data.Title);
			const imageSize = this.settings.imageSize || 200;
			template = template.replace("{{Poster}}", `![[${this.settings.assetPath}/${fileName}.jpg|movie|${imageSize}]]`);
		} else {
			template = template.replace("{{Poster}}", "-");
		}
		if (this.settings.youtubeapikey) {
			// format trailer
			const trailer = await this.getTrailerOnYoutube(data.Title);
			template = template.replace("{{Trailer}}", `<iframe class="movie" width="560" height="315" src="https://www.youtube.com/embed/${trailer}" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`);
		} else {
			template = template.replace("{{Trailer}}", "");
		}

		return template;
	}

	async formatMovie(movie: any) {
		let template = this.settings.template;
		template = await this.formatter(movie, template);
		return template;
	}

	async crawlAndAdd(text: string) {
		//check api keys
		if (!this.settings.omdbapikey) {
			new Notice("Please enter your OMDB API key in the settings.");
			return;
		}
		if (!this.settings.youtubeapikey) {
			new Notice("Youtube API key is missing. Trailer will not be added.");
		}
		const movie = await this.crawlMovie(text);
		if (!movie) {
			return;
		}
		const title = movie.Title;
		this.addImageToAssets(movie.Poster, title + ".jpg");
		const movieStr = await this.formatMovie(movie);
		await this.addContentToFile(movieStr, movie);
	}

	getUrl(text: string) {
		if (/tt\d+$/.test(text))
			return this.omdbApiUrl + "i=" + text // this is an imdb ID
	  	else if (/\s\([\d]{4}\)/.test(text)) 
			return this.omdbApiUrl + "t=" + text.replace(/\s\([\d]{4}\)/, "") + "&y=" +  text.match(/\(([\d]{4})\)/)?.[1] // movie year
	  	else 
			return this.omdbApiUrl + "t=" + text // this is the movie title only
	}

	async crawlMovie(text: string) {
		const movieUrl = this.getUrl(text);
		try {
			const response = await requestUrl({
				url: movieUrl,
				method: "GET",
			});
			console.log(response);
			const movie = response.json;
			movie.Title = movie.Title.replace(/[/\\?%*:|"<>]/g, '-');
			return movie;
		} catch (e) {
			new Notice("Movie not found.");
			new Notice(e);
			new Notice(movieUrl);
			return;
		}
	}

	async addContentToFile(text: string, movie: any) {
		const { vault } = this.app;
		const mainPath = this.settings.mainPath;
		const fileName = await this.formatter(movie, this.settings.fileName);
		await vault.create(mainPath + "/" + fileName + ".md", text);
		await this.app.workspace.openLinkText('', mainPath + "/" + fileName + ".md");
		new Notice("Movie added successfully!");
	}

	updateKeys() {
		this.omdbApiUrl = extractMovieUrl.replace("{key}", this.settings.omdbapikey);
		this.youtubeApiUrl = youtubeApiUrl.replace("{key}", this.settings.youtubeapikey);
	}

	async onload() {
		await this.loadSettings();
		this.updateKeys();

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('clapperboard', 'Get Movie', (event) => {
			const sel = window.getSelection() ?? "";
			const text = sel.toString();
			if (text) {
				this.crawlAndAdd(text);
			} else {
				new MovieModal(this.app, (result) => {
					this.crawlAndAdd(result);
				}).open();
			}
		});

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'crawl-movie',
			name: 'Crawl Movie',
			callback: () => {
				new MovieModal(this.app, (result) => {
					this.crawlAndAdd(result);
				}).open();
			}
		});

		this.addSettingTab(new SampleSettingTab(this.app, this));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

export class MovieModal extends Modal {
	result: string;
	onSubmit: (result: string) => void;

	constructor(app: App, onSubmit: (result: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;

		contentEl.createEl("h1", { text: "Movie name or IMDB id" });

		new Setting(contentEl)
			.setName("Name")
			.addText((text) =>
				text.onChange((value) => {
					this.result = value
				}));

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Submit")
					.setCta()
					.onClick(() => {
						this.close();
						this.onSubmit(this.result);
					}));
	}

	onClose() {
		let { contentEl } = this;
		contentEl.empty();
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: MoviePlugin;

	constructor(app: App, plugin: MoviePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		const variables = ["Title", "Year", "Rated", "Released", "Runtime", "Genre", "Director", "Writer", "Actors", "Plot", "Language", "Country", "Awards", "Poster", "Metascore", "imdbRating", "imdbVotes", "imdbID", "Type", "DVD", "BoxOffice"];

		const variablesStr = variables.map((variable) => {
			return "{{" + variable + "}}";
		}).join(", ");

		new Setting(containerEl)
			.setName('Info')
			.setDesc('Supported variables: ' + variablesStr)

		new Setting(containerEl)
			.setName('OMDB API Key')
			.setDesc('It\'s a key for OMDB API')
			.addText(text => text
				.setPlaceholder('Enter your key')
				.setValue(this.plugin.settings.omdbapikey)
				.onChange(async (value) => {
					this.plugin.settings.omdbapikey = value;
					await this.plugin.saveSettings();
					this.plugin.updateKeys();
				}));

		new Setting(containerEl)
			.setName('Youtube API Key')
			.setDesc('It\'s a key for Youtube API')
			.addText(text => text
				.setPlaceholder('Enter your key')
				.setValue(this.plugin.settings.youtubeapikey)
				.onChange(async (value) => {
					this.plugin.settings.youtubeapikey = value;
					await this.plugin.saveSettings();
					this.plugin.updateKeys();
				}));

		containerEl.createEl('h2', { text: 'Structure' });

		new Setting(containerEl)
			.setName('Template')
			.setDesc('It\'s a template for your movie note.')
			.addTextArea(text => text
				.setPlaceholder('Enter your template')
				.setValue(this.plugin.settings.template)
				.onChange(async (value) => {
					this.plugin.settings.template = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Main Path')
			.setDesc('It\'s a path for your movie note')
			.addText(text => text
				.setPlaceholder('Enter your path')
				.setValue(this.plugin.settings.mainPath)
				.onChange(async (value) => {
					this.plugin.settings.mainPath = value;
					await this.plugin.saveSettings();
				}
				));

		new Setting(containerEl)
			.setName('File name')
			.setDesc('It\'s a file name for your movie note')
			.addText(text => text
				.setPlaceholder('Enter your file name')
				.setValue(this.plugin.settings.fileName)
				.onChange(async (value) => {
					this.plugin.settings.fileName = value;
					await this.plugin.saveSettings();
				}
				));

		new Setting(containerEl)
			.setName('Image Path')
			.setDesc('It\'s a path for your movie note')
			.addText(text => text
				.setPlaceholder('Enter your path')
				.setValue(this.plugin.settings.assetPath)
				.onChange(async (value) => {
					this.plugin.settings.assetPath = value;
					await this.plugin.saveSettings();
				}
				));

		new Setting(containerEl)
			.setName('File Name')
			.setDesc('It\'s a file name for your movie note')
			.addText(text => text
				.setPlaceholder('Enter your file name')
				.setValue(this.plugin.settings.fileName)
				.onChange(async (value) => {
					this.plugin.settings.fileName = value;
					await this.plugin.saveSettings();
				}
				));
		containerEl.createEl('h2', { text: 'Advanced' });

		new Setting(containerEl)
			.setName('Image Size')
			.setDesc('It\'s a size for your movie note')
			.addText(text => text
				.setPlaceholder('Enter your size')
				.setValue(this.plugin.settings.imageSize.toString())
				.onChange(async (value) => {
					this.plugin.settings.imageSize = parseInt(value);
					await this.plugin.saveSettings();
				}
				));

	}
}
