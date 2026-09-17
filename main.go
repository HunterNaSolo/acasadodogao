package main

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

var AppVersion = "1.0.0"

const listenAddr = "127.0.0.1:34567"

//go:embed web/*
var webFiles embed.FS

type Settings struct {
	BusinessName string `json:"businessName"`
	GitHubOwner  string `json:"githubOwner"`
	GitHubRepo   string `json:"githubRepo"`
}

type StockItem struct {
	ID   string  `json:"id"`
	Name string  `json:"name"`
	Qty  float64 `json:"qty"`
	Unit string  `json:"unit"`
	Min  float64 `json:"min"`
	Cost float64 `json:"cost"`
}

type RecipeItem struct {
	StockID string  `json:"stockId"`
	Qty     float64 `json:"qty"`
}

type Product struct {
	ID     string       `json:"id"`
	Name   string       `json:"name"`
	Price  float64      `json:"price"`
	Active bool         `json:"active"`
	Recipe []RecipeItem `json:"recipe"`
}

type Extra struct {
	StockID string  `json:"stockId"`
	Qty     float64 `json:"qty"`
	Price   float64 `json:"price"`
}

type Sale struct {
	ID          string   `json:"id"`
	Date        string   `json:"date"`
	ProductID   string   `json:"productId"`
	ProductName string   `json:"productName"`
	Qty         int      `json:"qty"`
	Payment     string   `json:"payment"`
	RemovedIDs  []string `json:"removedIds"`
	Extras      []Extra  `json:"extras"`
	Revenue     float64  `json:"revenue"`
	COGS        float64  `json:"cogs"`
	Fee         float64  `json:"fee"`
	Result      float64  `json:"result"`
}

type CashEntry struct {
	ID          string  `json:"id"`
	Date        string  `json:"date"`
	Type        string  `json:"type"` // income | expense
	Category    string  `json:"category"`
	Description string  `json:"description"`
	Value       float64 `json:"value"`
	Kind        string  `json:"kind"` // manual | inventory_purchase
}

type Purchase struct {
	ID        string  `json:"id"`
	Date      string  `json:"date"`
	StockID   string  `json:"stockId"`
	StockName string  `json:"stockName"`
	Qty       float64 `json:"qty"`
	Total     float64 `json:"total"`
}

type Data struct {
	SchemaVersion int         `json:"schemaVersion"`
	Settings      Settings    `json:"settings"`
	Stock         []StockItem `json:"stock"`
	Products      []Product   `json:"products"`
	Sales         []Sale      `json:"sales"`
	Cash          []CashEntry `json:"cash"`
	Purchases     []Purchase  `json:"stockPurchases"`
}

type Store struct {
	mu   sync.Mutex
	path string
}

func defaultData() Data {
	return Data{
		SchemaVersion: 1,
		Settings:      Settings{BusinessName: "Meu Delivery"},
		Stock: []StockItem{
			{ID: "st_pao", Name: "Pão de hot dog", Qty: 40, Unit: "un", Min: 15, Cost: .90},
			{ID: "st_salsicha", Name: "Salsicha", Qty: 70, Unit: "un", Min: 25, Cost: .75},
			{ID: "st_calabresa", Name: "Calabresa", Qty: 2.5, Unit: "kg", Min: 1, Cost: 26},
			{ID: "st_mussarela", Name: "Muçarela", Qty: 2, Unit: "kg", Min: .8, Cost: 38},
			{ID: "st_milho", Name: "Milho verde", Qty: 8, Unit: "pacote", Min: 3, Cost: 4.50},
			{ID: "st_batata", Name: "Batata palha", Qty: 6, Unit: "pacote", Min: 2, Cost: 9},
			{ID: "st_ketchup", Name: "Ketchup", Qty: 3, Unit: "litro", Min: 1, Cost: 12},
			{ID: "st_mostarda", Name: "Mostarda", Qty: 2, Unit: "litro", Min: 1, Cost: 10},
			{ID: "st_maionese", Name: "Maionese", Qty: 3, Unit: "litro", Min: 1, Cost: 14},
		},
		Products: []Product{{
			ID: "pr_dogao", Name: "Dogão Completo", Price: 28, Active: true,
			Recipe: []RecipeItem{
				{StockID: "st_pao", Qty: 1}, {StockID: "st_salsicha", Qty: 2},
				{StockID: "st_calabresa", Qty: .08}, {StockID: "st_mussarela", Qty: .06},
				{StockID: "st_milho", Qty: .12}, {StockID: "st_batata", Qty: .08},
				{StockID: "st_ketchup", Qty: .03}, {StockID: "st_mostarda", Qty: .02}, {StockID: "st_maionese", Qty: .03},
			},
		}},
		Sales: []Sale{}, Cash: []CashEntry{}, Purchases: []Purchase{},
	}
}

func dataDir() string {
	if runtime.GOOS == "windows" {
		if v := os.Getenv("APPDATA"); v != "" {
			return filepath.Join(v, "GestaoDelivery")
		}
	}
	if d, err := os.UserConfigDir(); err == nil {
		return filepath.Join(d, "GestaoDelivery")
	}
	return filepath.Join(".", "GestaoDeliveryData")
}

func newStore() (*Store, error) {
	dir := dataDir()
	if err := os.MkdirAll(filepath.Join(dir, "backups"), 0755); err != nil {
		return nil, err
	}
	s := &Store{path: filepath.Join(dir, "delivery-data.json")}
	if _, err := os.Stat(s.path); errors.Is(err, os.ErrNotExist) {
		if err := s.saveUnlocked(defaultData(), false); err != nil {
			return nil, err
		}
	}
	return s, nil
}

func (s *Store) loadUnlocked() (Data, error) {
	b, err := os.ReadFile(s.path)
	if err != nil {
		return Data{}, err
	}
	var d Data
	if err := json.Unmarshal(b, &d); err != nil {
		return Data{}, err
	}
	if d.Settings.BusinessName == "" {
		d.Settings.BusinessName = "Meu Delivery"
	}
	if d.Stock == nil {
		d.Stock = []StockItem{}
	}
	if d.Products == nil {
		d.Products = []Product{}
	}
	if d.Sales == nil {
		d.Sales = []Sale{}
	}
	if d.Cash == nil {
		d.Cash = []CashEntry{}
	}
	if d.Purchases == nil {
		d.Purchases = []Purchase{}
	}
	return d, nil
}

func (s *Store) Load() (Data, error) { s.mu.Lock(); defer s.mu.Unlock(); return s.loadUnlocked() }

func (s *Store) backupUnlocked() {
	b, err := os.ReadFile(s.path)
	if err != nil {
		return
	}
	dir := filepath.Join(filepath.Dir(s.path), "backups")
	name := "delivery-data-" + time.Now().Format("20060102-150405.000") + ".json"
	_ = os.WriteFile(filepath.Join(dir, name), b, 0644)
	entries, _ := os.ReadDir(dir)
	if len(entries) > 30 {
		for i := 0; i < len(entries)-30; i++ {
			_ = os.Remove(filepath.Join(dir, entries[i].Name()))
		}
	}
}

func (s *Store) saveUnlocked(d Data, backup bool) error {
	if backup {
		s.backupUnlocked()
	}
	b, err := json.MarshalIndent(d, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0644); err != nil {
		return err
	}
	if runtime.GOOS == "windows" {
		_ = os.Remove(s.path)
	}
	return os.Rename(tmp, s.path)
}

func (s *Store) Update(fn func(*Data) error) (Data, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	d, err := s.loadUnlocked()
	if err != nil {
		return Data{}, err
	}
	if err := fn(&d); err != nil {
		return Data{}, err
	}
	if err := s.saveUnlocked(d, true); err != nil {
		return Data{}, err
	}
	return d, nil
}

func id(prefix string) string { return fmt.Sprintf("%s_%d", prefix, time.Now().UnixNano()) }
func nowISO() string          { return time.Now().Format(time.RFC3339) }
func cleanN(v float64) float64 {
	if v < 0 {
		return 0
	}
	return v
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func readJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(io.LimitReader(r.Body, 8<<20))
	return dec.Decode(v)
}
func apiErr(w http.ResponseWriter, err error) {
	writeJSON(w, 400, map[string]string{"error": err.Error()})
}

func findStock(d *Data, sid string) *StockItem {
	for i := range d.Stock {
		if d.Stock[i].ID == sid {
			return &d.Stock[i]
		}
	}
	return nil
}
func findProduct(d *Data, pid string) *Product {
	for i := range d.Products {
		if d.Products[i].ID == pid {
			return &d.Products[i]
		}
	}
	return nil
}

func registerAPI(mux *http.ServeMux, store *Store) {
	mux.HandleFunc("/api/info", func(w http.ResponseWriter, r *http.Request) {
		exe, _ := os.Executable()
		writeJSON(w, 200, map[string]any{"version": AppVersion, "dataPath": store.path, "exePath": exe})
	})
	mux.HandleFunc("/api/data", func(w http.ResponseWriter, r *http.Request) {
		d, err := store.Load()
		if err != nil {
			apiErr(w, err)
			return
		}
		writeJSON(w, 200, d)
	})
	mux.HandleFunc("/api/settings", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(405)
			return
		}
		var in Settings
		if err := readJSON(r, &in); err != nil {
			apiErr(w, err)
			return
		}
		d, err := store.Update(func(d *Data) error {
			if strings.TrimSpace(in.BusinessName) != "" {
				d.Settings.BusinessName = strings.TrimSpace(in.BusinessName)
			}
			d.Settings.GitHubOwner = strings.TrimSpace(in.GitHubOwner)
			d.Settings.GitHubRepo = strings.TrimSpace(in.GitHubRepo)
			return nil
		})
		if err != nil {
			apiErr(w, err)
			return
		}
		writeJSON(w, 200, d)
	})
	mux.HandleFunc("/api/stock/add", func(w http.ResponseWriter, r *http.Request) {
		var in StockItem
		if err := readJSON(r, &in); err != nil {
			apiErr(w, err)
			return
		}
		d, err := store.Update(func(d *Data) error {
			in.ID = id("st")
			in.Name = strings.TrimSpace(in.Name)
			in.Qty = cleanN(in.Qty)
			in.Min = cleanN(in.Min)
			in.Cost = cleanN(in.Cost)
			if in.Name == "" {
				return errors.New("Informe o nome do ingrediente.")
			}
			if in.Unit == "" {
				in.Unit = "un"
			}
			d.Stock = append(d.Stock, in)
			return nil
		})
		if err != nil {
			apiErr(w, err)
			return
		}
		writeJSON(w, 200, d)
	})
	mux.HandleFunc("/api/stock/update", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			ID, Name, Unit string
			Qty, Min, Cost *float64
		}
		if err := readJSON(r, &in); err != nil {
			apiErr(w, err)
			return
		}
		d, err := store.Update(func(d *Data) error {
			item := findStock(d, in.ID)
			if item == nil {
				return errors.New("Ingrediente não encontrado.")
			}
			if strings.TrimSpace(in.Name) != "" {
				item.Name = strings.TrimSpace(in.Name)
			}
			if in.Unit != "" {
				item.Unit = in.Unit
			}
			if in.Qty != nil {
				item.Qty = cleanN(*in.Qty)
			}
			if in.Min != nil {
				item.Min = cleanN(*in.Min)
			}
			if in.Cost != nil {
				item.Cost = cleanN(*in.Cost)
			}
			return nil
		})
		if err != nil {
			apiErr(w, err)
			return
		}
		writeJSON(w, 200, d)
	})
	mux.HandleFunc("/api/stock/restock", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			StockID string  `json:"stockId"`
			Qty     float64 `json:"qty"`
			Total   float64 `json:"total"`
		}
		if err := readJSON(r, &in); err != nil {
			apiErr(w, err)
			return
		}
		d, err := store.Update(func(d *Data) error {
			item := findStock(d, in.StockID)
			if item == nil {
				return errors.New("Ingrediente não encontrado.")
			}
			in.Qty = cleanN(in.Qty)
			in.Total = cleanN(in.Total)
			if in.Qty <= 0 {
				return errors.New("Informe uma quantidade maior que zero.")
			}
			oldValue := item.Qty * item.Cost
			item.Qty += in.Qty
			item.Cost = (oldValue + in.Total) / item.Qty
			p := Purchase{ID: id("buy"), Date: nowISO(), StockID: item.ID, StockName: item.Name, Qty: in.Qty, Total: in.Total}
			d.Purchases = append(d.Purchases, p)
			d.Cash = append(d.Cash, CashEntry{ID: id("cash"), Date: nowISO(), Type: "expense", Category: "Compra de insumos", Description: "Reposição de " + item.Name, Value: in.Total, Kind: "inventory_purchase"})
			return nil
		})
		if err != nil {
			apiErr(w, err)
			return
		}
		writeJSON(w, 200, d)
	})
	mux.HandleFunc("/api/product/add", func(w http.ResponseWriter, r *http.Request) {
		var in Product
		if err := readJSON(r, &in); err != nil {
			apiErr(w, err)
			return
		}
		d, err := store.Update(func(d *Data) error {
			in.ID = id("pr")
			in.Name = strings.TrimSpace(in.Name)
			in.Price = cleanN(in.Price)
			in.Active = true
			if in.Name == "" {
				return errors.New("Informe o nome do lanche.")
			}
			var recipe []RecipeItem
			for _, x := range in.Recipe {
				if x.Qty > 0 && findStock(d, x.StockID) != nil {
					recipe = append(recipe, RecipeItem{StockID: x.StockID, Qty: x.Qty})
				}
			}
			if len(recipe) == 0 {
				return errors.New("Adicione pelo menos um ingrediente.")
			}
			in.Recipe = recipe
			d.Products = append(d.Products, in)
			return nil
		})
		if err != nil {
			apiErr(w, err)
			return
		}
		writeJSON(w, 200, d)
	})
	mux.HandleFunc("/api/product/update", func(w http.ResponseWriter, r *http.Request) {
		var in Product
		if err := readJSON(r, &in); err != nil {
			apiErr(w, err)
			return
		}
		d, err := store.Update(func(d *Data) error {
			p := findProduct(d, in.ID)
			if p == nil {
				return errors.New("Lanche não encontrado.")
			}
			if strings.TrimSpace(in.Name) != "" {
				p.Name = strings.TrimSpace(in.Name)
			}
			p.Price = cleanN(in.Price)
			p.Active = in.Active
			if in.Recipe != nil {
				p.Recipe = in.Recipe
			}
			return nil
		})
		if err != nil {
			apiErr(w, err)
			return
		}
		writeJSON(w, 200, d)
	})
	mux.HandleFunc("/api/sale/add", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			ProductID  string   `json:"productId"`
			Qty        int      `json:"qty"`
			Payment    string   `json:"payment"`
			Fee        float64  `json:"fee"`
			RemovedIDs []string `json:"removedIds"`
			Extras     []Extra  `json:"extras"`
		}
		if err := readJSON(r, &in); err != nil {
			apiErr(w, err)
			return
		}
		d, err := store.Update(func(d *Data) error {
			p := findProduct(d, in.ProductID)
			if p == nil {
				return errors.New("Lanche não encontrado.")
			}
			if in.Qty < 1 {
				in.Qty = 1
			}
			in.Fee = cleanN(in.Fee)
			removed := map[string]bool{}
			for _, x := range in.RemovedIDs {
				removed[x] = true
			}
			needs := map[string]float64{}
			cogs := 0.0
			for _, r := range p.Recipe {
				if !removed[r.StockID] {
					needs[r.StockID] += r.Qty * float64(in.Qty)
				}
			}
			extraRevenue := 0.0
			for _, x := range in.Extras {
				if x.Qty > 0 {
					needs[x.StockID] += x.Qty * float64(in.Qty)
					extraRevenue += cleanN(x.Price) * float64(in.Qty)
				}
			}
			for sid, amount := range needs {
				item := findStock(d, sid)
				if item == nil {
					return errors.New("Um ingrediente do pedido não existe mais no estoque.")
				}
				if item.Qty+1e-9 < amount {
					return fmt.Errorf("Estoque insuficiente de %s. Disponível: %.3f %s", item.Name, item.Qty, item.Unit)
				}
				cogs += item.Cost * amount
			}
			for sid, amount := range needs {
				item := findStock(d, sid)
				item.Qty -= amount
				if item.Qty < 0 {
					item.Qty = 0
				}
			}
			revenue := p.Price*float64(in.Qty) + extraRevenue
			sale := Sale{ID: id("sale"), Date: nowISO(), ProductID: p.ID, ProductName: p.Name, Qty: in.Qty, Payment: in.Payment, RemovedIDs: in.RemovedIDs, Extras: in.Extras, Revenue: revenue, COGS: cogs, Fee: in.Fee, Result: revenue - cogs - in.Fee}
			d.Sales = append(d.Sales, sale)
			return nil
		})
		if err != nil {
			apiErr(w, err)
			return
		}
		writeJSON(w, 200, d)
	})
	mux.HandleFunc("/api/cash/add", func(w http.ResponseWriter, r *http.Request) {
		var in CashEntry
		if err := readJSON(r, &in); err != nil {
			apiErr(w, err)
			return
		}
		d, err := store.Update(func(d *Data) error {
			in.ID = id("cash")
			in.Date = nowISO()
			if in.Type != "income" {
				in.Type = "expense"
			}
			in.Value = cleanN(in.Value)
			in.Kind = "manual"
			if in.Value <= 0 {
				return errors.New("Informe um valor maior que zero.")
			}
			d.Cash = append(d.Cash, in)
			return nil
		})
		if err != nil {
			apiErr(w, err)
			return
		}
		writeJSON(w, 200, d)
	})
	mux.HandleFunc("/api/data/open-folder", func(w http.ResponseWriter, r *http.Request) {
		dir := filepath.Dir(store.path)
		if runtime.GOOS == "windows" {
			_ = exec.Command("explorer", dir).Start()
		} else if runtime.GOOS == "darwin" {
			_ = exec.Command("open", dir).Start()
		} else {
			_ = exec.Command("xdg-open", dir).Start()
		}
		writeJSON(w, 200, map[string]bool{"ok": true})
	})
	mux.HandleFunc("/api/backup/export", func(w http.ResponseWriter, r *http.Request) {
		d, err := store.Load()
		if err != nil {
			apiErr(w, err)
			return
		}
		b, _ := json.MarshalIndent(d, "", "  ")
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Disposition", `attachment; filename="backup-gestao-delivery.json"`)
		_, _ = w.Write(b)
	})
	mux.HandleFunc("/api/backup/import", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(405)
			return
		}
		var d Data
		if err := readJSON(r, &d); err != nil {
			apiErr(w, errors.New("Backup inválido."))
			return
		}
		if d.Stock == nil || d.Products == nil {
			apiErr(w, errors.New("Backup incompatível."))
			return
		}
		store.mu.Lock()
		err := store.saveUnlocked(d, true)
		store.mu.Unlock()
		if err != nil {
			apiErr(w, err)
			return
		}
		writeJSON(w, 200, d)
	})
	mux.HandleFunc("/api/update/check", func(w http.ResponseWriter, r *http.Request) {
		d, err := store.Load()
		if err != nil {
			apiErr(w, err)
			return
		}
		owner := strings.TrimSpace(d.Settings.GitHubOwner)
		repo := strings.TrimSpace(d.Settings.GitHubRepo)
		if owner == "" || repo == "" {
			apiErr(w, errors.New("Configure seu usuário e repositório do GitHub primeiro."))
			return
		}
		rel, err := getLatestRelease(owner, repo)
		if err != nil {
			apiErr(w, err)
			return
		}
		latest := strings.TrimPrefix(rel.TagName, "v")
		asset := ""
		for _, a := range rel.Assets {
			if strings.EqualFold(a.Name, "GestaoDelivery.exe") {
				asset = a.URL
				break
			}
		}
		writeJSON(w, 200, map[string]any{"current": AppVersion, "latest": latest, "newer": versionGreater(latest, AppVersion), "assetUrl": asset, "releaseUrl": rel.HTMLURL})
	})
	mux.HandleFunc("/api/update/install", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			URL string `json:"url"`
		}
		if err := readJSON(r, &in); err != nil {
			apiErr(w, err)
			return
		}
		if !strings.HasPrefix(in.URL, "https://github.com/") {
			apiErr(w, errors.New("URL de atualização inválida."))
			return
		}
		exe, err := os.Executable()
		if err != nil {
			apiErr(w, err)
			return
		}
		tmp := filepath.Join(os.TempDir(), "GestaoDelivery-update.exe")
		if err := downloadFile(in.URL, tmp); err != nil {
			apiErr(w, err)
			return
		}
		if runtime.GOOS != "windows" {
			apiErr(w, errors.New("A instalação automática só funciona no Windows."))
			return
		}
		cmdPath := filepath.Join(os.TempDir(), "GestaoDelivery-update.cmd")
		script := fmt.Sprintf("@echo off\r\ntimeout /t 2 /nobreak >nul\r\ncopy /Y \"%s\" \"%s\" >nul\r\nstart \"\" \"%s\"\r\ndel /Q \"%s\"\r\ndel /Q \"%%~f0\"\r\n", tmp, exe, exe, tmp)
		if err := os.WriteFile(cmdPath, []byte(script), 0644); err != nil {
			apiErr(w, err)
			return
		}
		writeJSON(w, 200, map[string]bool{"ok": true})
		go func() {
			time.Sleep(700 * time.Millisecond)
			_ = exec.Command("cmd", "/C", "start", "", cmdPath).Start()
			os.Exit(0)
		}()
	})
	mux.HandleFunc("/api/quit", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]bool{"ok": true})
		go func() { time.Sleep(250 * time.Millisecond); os.Exit(0) }()
	})
}

type ghRelease struct {
	TagName string `json:"tag_name"`
	HTMLURL string `json:"html_url"`
	Assets  []struct {
		Name string `json:"name"`
		URL  string `json:"browser_download_url"`
	} `json:"assets"`
}

func getLatestRelease(owner, repo string) (ghRelease, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/releases/latest", owner, repo)
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("User-Agent", "GestaoDelivery/"+AppVersion)
	c := &http.Client{Timeout: 15 * time.Second}
	resp, err := c.Do(req)
	if err != nil {
		return ghRelease{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return ghRelease{}, fmt.Errorf("GitHub respondeu %s", resp.Status)
	}
	var rel ghRelease
	err = json.NewDecoder(resp.Body).Decode(&rel)
	return rel, err
}
func downloadFile(url, target string) error {
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("User-Agent", "GestaoDelivery/"+AppVersion)
	c := &http.Client{Timeout: 2 * time.Minute}
	resp, err := c.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("falha no download: %s", resp.Status)
	}
	f, err := os.Create(target)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, resp.Body)
	return err
}
func versionGreater(a, b string) bool {
	pa := strings.Split(a, ".")
	pb := strings.Split(b, ".")
	for len(pa) < 3 {
		pa = append(pa, "0")
	}
	for len(pb) < 3 {
		pb = append(pb, "0")
	}
	for i := 0; i < 3; i++ {
		ai, _ := strconv.Atoi(strings.TrimFunc(pa[i], func(r rune) bool { return r < '0' || r > '9' }))
		bi, _ := strconv.Atoi(strings.TrimFunc(pb[i], func(r rune) bool { return r < '0' || r > '9' }))
		if ai != bi {
			return ai > bi
		}
	}
	return false
}

func openApp(url string) {
	if runtime.GOOS == "windows" {
		candidates := []string{
			filepath.Join(os.Getenv("ProgramFiles(x86)"), "Microsoft", "Edge", "Application", "msedge.exe"),
			filepath.Join(os.Getenv("ProgramFiles"), "Microsoft", "Edge", "Application", "msedge.exe"),
		}
		for _, p := range candidates {
			if p != "" {
				if _, err := os.Stat(p); err == nil {
					_ = exec.Command(p, "--app="+url, "--start-maximized").Start()
					return
				}
			}
		}
		_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
		return
	}
	if runtime.GOOS == "darwin" {
		_ = exec.Command("open", url).Start()
		return
	}
	_ = exec.Command("xdg-open", url).Start()
}

func main() {
	ln, err := net.Listen("tcp", listenAddr)
	if err != nil {
		openApp("http://" + listenAddr)
		return
	}
	store, err := newStore()
	if err != nil {
		return
	}
	mux := http.NewServeMux()
	registerAPI(mux, store)
	sub, _ := fs.Sub(webFiles, "web")
	mux.Handle("/", http.FileServer(http.FS(sub)))
	go func() { _ = http.Serve(ln, mux) }()
	time.Sleep(200 * time.Millisecond)
	openApp("http://" + listenAddr)
	select {}
}
